# Feedback

A button for any web page that sends a report home. A person presses Feedback, picks Bug, Feature
request or Message, types what they mean, can attach a screenshot or a short recording of the tab,
and sends; the report arrives at your own server with the page's address, the browser's details
and the console errors the page had thrown. It is two plain JavaScript files with no dependencies
and no build step, and nothing goes to a third party.

- [Install](#install)
- [Settings](#settings) and [data attributes](#data-attributes)
- [The API](#the-api)
- [Labels](#labels)
- [Theming](#theming)
- [Content Security Policy](#content-security-policy)
- [Accessibility](#accessibility)
- [Privacy: what is collected and scrubbed](#privacy-what-is-collected-and-scrubbed)
- [The protocol](#the-protocol), the contract a receiver implements
- [Example receivers and the conformance check](#example-receivers-and-the-conformance-check)
- [Recording across pages](#recording-across-pages)
- [Browser support](#browser-support)
- [Size](#size)
- [Running the tests](#running-the-tests)

## Install

Copy the two files, at the version you want, into your own static files and serve them from your
own origin. There is no shared CDN on purpose: no page of yours depends on someone else's host.

```
feedback.js         the stub, loaded by every page (about 11 KB, 4.0 KB gzipped)
feedbackPanel.js    the panel, fetched on the first press only, then cached
```

Keep them side by side: the stub loads `feedbackPanel.js` from the same directory unless
`panelSrc` says otherwise. Deploy both from the same release; a panel of another major version
refuses to open and says so in the console. To bust caches, version the stub's address alone
(`feedback.js?v=1732377600`): without `panelSrc`, the panel is fetched with the stub's query
(`feedbackPanel.js?v=1732377600`), so a new stub is never paired with a cached old panel. An
explicit `panelSrc` is used exactly as given.

The smallest working page:

```html
<script src="/static/feedback.js" data-endpoint="/api/feedback" defer></script>
…
<button type="button" data-feedback>Feedback</button>
```

Any element matching `[data-feedback]` opens the panel. The endpoint is yours; see
[What a receiver must do](#what-a-receiver-must-do), or start from an
[example receiver](#example-receivers-and-the-conformance-check).

With a script of your own instead of attributes:

```html
<script src="/static/feedback.js" defer></script>
<script type="module">
  feedback.init({
    endpoint: '/api/feedback',
    project: 'store',
    release: '4f2a9c1',
    user: {id: 1042, name: 'Ada Lovelace'},
    launcher: {position: 'bottom-right', label: 'Feedback'}
  });
</script>
```

A module script, a later deferred script or a `DOMContentLoaded` listener all run after the
deferred stub. A plain inline `<script>` placed after the stub's tag does not: it runs while the
page is still being parsed, before any deferred script, and `feedback` is not defined yet.

The stub itself is a classic script. Loaded with `type="module"` it has no
`document.currentScript`, so it reads no `data-` attributes and cannot find the panel beside
itself: it then works only from `init()` with `panelSrc` given, and says so in the console (the
"no endpoint" warning names the module case; an open without `panelSrc` is one error).

### When the settings freeze

Settings are read once. They freeze at the first of:

1. a call to `feedback.init()`,
2. the first press of a trigger, the launcher or `feedback.open()`,
3. the window's `load` event.

So `init()` may come from anything that runs before the page has finished loading, and a page
that configures the widget with attributes alone is settled at `load`. An `init()` after that
point warns and is ignored; what a page learns later (who signed in) goes through
`feedback.setContext()`. A stub that is itself inserted after the `load` event freezes at the
first `init()` or open instead.

Without an `endpoint` at that moment the widget is off: it logs one warning, removes its
listeners, keeps nothing, and draws nothing.

### On sign-out

Call `feedback.reset()` when a person signs out. It empties the error buffer, removes the saved
draft from `sessionStorage`, closes the panel and discards the form and any screenshot or
recording, ends a recording across pages, and leaves out of later reports every request made
before it. Whatever was still under way is dropped when it finishes: a screenshot or recording
the browser was still asking for, a panel still loading (it does not open), and a send in flight,
whose answer is ignored (that request is not called back, so its report may still arrive at the
receiver). The next person at a shared terminal inherits none of it. A page that learns who signed in after
loading passes them with `feedback.setContext({user: {id, name}})`; a draft typed under another
`user.id` is discarded when the panel next opens.

### A host that wraps the console

When the stub runs it replaces `console.error` and `console.warn` with a wrapper that first calls
whatever function was there at that moment, then records the entry. So:

- A host that wraps the console before the stub loads is chained: the stub's wrapper calls the
  host's wrapper, which calls the browser's own function.
- A host that wraps after the stub loads is chained the other way: its wrapper calls the stub's.
- A host that later puts back functions it saved before the stub loaded (a debug switch that
  "restores the originals", say) removes the stub's wrapper along with its own. Nothing throws or
  loops, but from then on `console.error` and `console.warn` are not recorded until the page
  reloads; uncaught errors, unhandled rejections and failed loads still are, since those are
  listeners. The stub cannot wrap again by itself, because it cannot tell when that happened. A
  host that wants recording to continue should switch its own layer off with a flag inside its
  wrapper rather than by putting saved functions back.

The widget's own warnings call the function it found when it loaded, so they never land in its
own buffer.

## Settings

Every setting, its type, its default and what it does. An unknown key, a wrong type or an
out-of-range number is one console warning naming the key, and the default is used. The stub
checks `endpoint`, `trigger`, `launcher`, `errorBufferSize`, `panelSrc` and `panelIntegrity` when
the settings freeze; the panel checks every other key once, when it loads on the first press, so
those warnings appear then.

Nothing here is a secret: everything in a page is public. A token that must ride on the request
comes from `headers` as a function, called at send time.

### Where and who

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `endpoint` | string | `''` | Required. Where the report is posted: a path on this page's origin, or an absolute `https:` address. `http:` is accepted only for this page's own origin, so local development works. Resolved against the page's address, never against a `<base>` element. Another origin is taken from `init()` only: a `data-endpoint` on another origin is refused with a warning, because markup injected into a page can write an attribute but cannot run `init()`. |
| `project` | string, up to 50 | `''` | Which project the page belongs to; sent as `project`. |
| `environment` | string, up to 30 | `''` | `production`, `staging`, … as you name them; sent as `environment`. |
| `release` | string, up to 40 | `''` | Your version or commit; sent as `release`. |
| `context` | object | `{}` | Anything else you want on the report. Copied once through `JSON.stringify`, so its values must be JSON. Over 16 KB as JSON, or more than 15 levels deep (the report around it makes 16), it is left out of the report with one warning. |
| `user` | `{id, name}` or `null` | `null` | Who the page thinks is signed in. Only `id` (string or number) and `name` (string) are kept, each cut to 200 characters. A claim by the page, never an identity; the draft is tied to `user.id`. |

### The request

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `credentials` | `'same-origin'`, `'include'`, `'omit'` | `'same-origin'` | The `fetch` credentials mode. A cross-origin receiver that relies on cookies needs `'include'` and its own CORS answer. |
| `headers` | object of strings, or a function returning one (sync or async) | `{}` | Extra request headers. A function is called on every send, so a token can be short-lived, and `timeoutMs` covers it. Any header makes the request a non-simple one and a cross-origin receiver gets a preflight. Function form: `init()` only. |
| `fields` | object of strings | `{}` | Extra form fields a receiver's dispatcher needs, such as `{action: 'submit'}` or a CSRF token. Numbers and booleans are sent as text. No key may be `report`, `screenshot` or `video`. |
| `timeoutMs` | integer, 1000 to 600000 | `60000` | How long a send may take, `beforeSend`, a `headers` function and the answer included, before it counts as failed. |

### The form

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `types` | array of 1 to 10 names | `['bug', 'feature', 'message']` | One button per entry. A name starts with a-z and holds letters, digits or `-`, up to 20 characters. With one entry it is picked already and the buttons are not shown. Your receiver keeps its own list of the types it takes. |
| `defaultType` | one of `types`, or `null` | `null` | Picked when the panel opens. `null`: the person must pick. |
| `messageMaxLength` | integer, 1 to 20000 | `5000` | The longest message. A counter appears from 80% of it. |
| `labels` | object of strings | `{}` | Any word the widget shows, by key; see [Labels](#labels). A missing key falls back to English. |
| `locale` | language tag or `''` | `''` | Sets the text direction (`ar`, `he`, `fa`, … are right to left) and how dates, numbers and lists are written. `''` uses the document's `lang`, then the browser's language. |

### Where the button is

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `trigger` | CSS selector | `'[data-feedback]'` | A click on any element matching it (or inside one, an open shadow root included) opens the panel. One delegated listener on the document, so elements added later work too. A selector the browser cannot parse is one warning and the default is used. |
| `launcher` | `false`, `true` or `{position, label}` | `false` | Draws a floating button of the widget's own. `position` is `'bottom-right'` (default), `'bottom-left'`, `'top-right'` or `'top-left'`; `label` defaults to `labels.launcher`, then `Feedback`, and is cut to 40 characters. This is the only setting that writes to the page before anyone presses anything. |
| `zIndex` | integer, 0 to 2147483647 | `2147483000` | The panel's and the launcher's stacking order. Anything else is the default. |
| `theme` | `'auto'`, `'light'`, `'dark'` | `'auto'` | `auto` follows `prefers-color-scheme`. |

### What is collected

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `collect` | object of booleans | `{errors: true, requests: true, client: true}` | Each switched off leaves its block out of the report and out of the "Also sent" line. Missing keys keep their default. |
| `errorBufferSize` | integer, 1 to 100 | `50` | How many console and error entries the stub keeps. |
| `requestCount` | integer, 1 to 100 | `30` | How many recent same-origin requests are sent. |
| `scrubParams` | array of strings | `[]` | Parameter names whose values are replaced with `…`, added to the built-in ones: `token`, `key`, `secret`, `password`, `code`, `signature`, `auth`, `apikey`, `api_key`, `access_token`, `sid`, `sessionid`, `jsessionid`, `phpsessid`, `session`, `pwd`, `pass`, `sig`, `jwt`, `otp`, `authorization`. A list here never removes a built-in name. See [Scrubbing](#scrubbing) for where and how a name matches. A URL's `user:password` part is always replaced. |
| `scrubPatterns` | array of `RegExp` or strings | `[]` | Extra regular expressions; every match in an error's message, source or stack and in every URL is replaced with `…`. A string is compiled with the `g` flag. The built-in patterns always run as well. |

### Capture

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `screenshot` | boolean | `true` | `false` removes the Screenshot button. |
| `anySurface` | boolean | `true` | In a browser that can capture but cannot promise this tab (Firefox today), take whatever window or screen the person picks in the browser's own picker, with a note saying so. `false` keeps the strict rule everywhere: there the Screenshot and Record buttons are not shown. Where the browser can capture this tab it is this tab only, whatever this says. See [Browser support](#browser-support). |
| `video` | `false`, `true` or object | see below | `false` removes the Record button; `true` is the defaults. |
| `video.maxSeconds` | integer, 1 to 600 | `60` | A recording stops by itself after this long. |
| `video.frameRate` | integer, 1 to 30 | `5` | Frames per second asked of the browser. |
| `video.maxWidth` | integer, 320 to 3840 | `1280` | The widest frame asked of the browser. |
| `video.bitsPerSecond` | integer, 50000 to 8000000 | `250000` | The encoder's target. A minute at the defaults is about 2 MB. |
| `video.maxBytes` | integer, 100000 to 104857600 | `10485760` | A recording stops before it would pass this size (within about a second's worth), so nobody waits on an upload that will be refused. Your receiver enforces its own limit regardless. |
| `video.follow` | boolean | `true` | A recording keeps going when the person goes to another page of the site; see [Recording across pages](#recording-across-pages). `false` installs nothing, and a recording ends at the page change. |

A page that should never be captured, one showing payment details for instance, sets
`screenshot: false, video: false`.

### Loading the panel

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `panelSrc` | string | `''` | Where `feedbackPanel.js` is. `''` means beside the stub. Must be `https:` or this page's origin, and on another origin it needs `panelIntegrity`; that rule applies to the default too, so a stub served from another origin (or a page with an injected `<base>`) needs `panelIntegrity` or a same-origin `panelSrc`. |
| `panelIntegrity` | SRI hash | `''` | A Subresource Integrity value such as `sha384-…`. When set, the panel's script element carries it and `crossorigin="anonymous"`, and the browser refuses a file that does not match. A value that is not one or more `sha256-`, `sha384-` or `sha512-` hashes is a warning and no panel loads at all (a browser ignores integrity metadata it cannot parse, which would load the panel unchecked). Make one with `openssl dgst -sha384 -binary feedbackPanel.js \| openssl base64 -A`. |

When the stub's own `<script>` element has a `nonce`, the panel's script element gets the same one.

### Hooks

All `init()` only.

| Setting | Called | With | Meaning |
|---|---|---|---|
| `beforeSend` | when Send is pressed, before the request | `(report, files)` | Your last word. Return the report (changed or not) to send it, or `false` to cancel; may be async. `files` is `{screenshot, video}` (Blobs, either may be absent); delete one to drop that part, and its `attachments` entry goes with it. The report is held under 256 KB again afterwards. A cancel sends nothing and leaves the form as it is; tell the person why yourself. A function that throws cancels; one that has not settled within `timeoutMs` ends in the failure row. What it returns is held to the protocol again (JSON, at most 16 levels, the required fields present and well typed, every capped field cut, `user` and `context` checked as the settings are); a report that fails that is not sent, with one console error naming `beforeSend`. A file it puts in `files` that is not a Blob of an allowed type is left out with one console error. |
| `onOpen` | each time the panel opens | nothing | |
| `onSent` | after a 2xx | `{id, message, report}` | `id` and `message` are the receiver's, `''` when it gave none. |
| `onError` | after a refusal or failure | `{status, code, message}` | `status` is 0 when no answer came; `code` is the receiver's code or the widget's name for the row (`failed`, `refused`, …). |

## Data attributes

Every setting except the function-valued ones can be given on the stub's own `<script>` element
as `data-` plus the setting's name in kebab case (`timeoutMs` is `data-timeout-ms`,
`panelIntegrity` is `data-panel-integrity`).

- Text settings take the attribute as it is: `endpoint`, `project`, `environment`, `release`,
  `credentials`, `defaultType`, `locale`, `trigger`, `theme`, `panelSrc`, `panelIntegrity`.
- Every other setting is read as JSON: numbers and booleans as they are (`data-timeout-ms="30000"`,
  `data-screenshot="false"`), objects and arrays as JSON text
  (`data-video='{"maxSeconds":30}'`, `data-video="false"`, `data-types='["bug","message"]'`,
  `data-collect='{"requests":false}'`, `data-launcher="true"`, `data-labels='{"send":"Submit"}'`).
  An attribute that is not valid JSON is one warning, and the default is used.
- `headers` as a function, `beforeSend`, `onOpen`, `onSent` and `onError` exist only in `init()`.
- An unknown `data-` attribute on the stub's tag is one warning, like an unknown key.

Precedence, each layer over the one before: the defaults, then the attributes, then `init()`.
It is key by key, and an object setting given in `init()` replaces the attribute's whole object
(its missing keys take their defaults, not the attribute's).

The attributes are read only when `document.currentScript` is really an `HTMLScriptElement`. A
page where an injected `<img name="currentScript">` shadows it is configured by `init()` alone,
and `panelSrc` must then be given, because the stub cannot tell where it was loaded from. The
document's `title` and `referrer` are read through `Document.prototype`, so an element named
`title` cannot stand in for them either. Other names a page's markup can shadow (DOM clobbering)
are the page's problem as much as the widget's: at worst such markup stops the widget loading or
opening. It cannot send a report to another origin, since no attribute sets one. Markup injected
ahead of the page's own stub tag can still add a copy of the stub, which then runs first: it is
in charge (the page's copy does nothing and says so in the console), with the injected `labels`
and a same-origin `endpoint` of the injection's choosing. A Content-Security-Policy that allows
scripts by nonce or hash, not by origin alone, stops that.

## The API

`window.feedback`:

| Call | Does |
|---|---|
| `feedback.init(settings)` | Sets the settings and freezes them. Once only; see [When the settings freeze](#when-the-settings-freeze). |
| `feedback.open()` | Opens the panel, loading it the first time. Focus returns to whatever had it. |
| `feedback.close()` | Closes the panel; the draft is kept. While recording, it stops the recording (keeping it) and stays closed. |
| `feedback.setContext({user, context})` | Replaces `user` and/or `context` for later reports, for a page that learns who signed in after loading. Checked like the settings; a bad value is one warning and is left out. |
| `feedback.reset()` | Empties the error buffer and the saved draft, closes the panel, discards the form and any attachment, and drops whatever was still under way; see [On sign-out](#on-sign-out). |
| `feedback.version` | The widget's version, `'1.2.0'`. |

Loading `feedback.js` twice on one page is harmless: the second copy sees the first and does
nothing, so the console is wrapped once and the trigger bound once. When the second copy's tag
carries different `data-` attributes, it says once in the console that the copy that ran first
is in charge.

## Labels

Every word the widget shows. Pass any of them in `labels`; `{n}`, `{id}`, `{time}`, `{status}`,
`{duration}` and `{list}` are filled in. For a type of your own in `types`, the label key is
`type` plus the name with its first letter capitalized (`question` is `typeQuestion`); without
one, the name itself is shown.

| Key | English |
|---|---|
| `launcher` | Feedback |
| `title` | Send feedback |
| `typeLegend` | Type of feedback (the type buttons' group name, read by screen readers) |
| `typeBug` | Bug |
| `typeFeature` | Feature request |
| `typeMessage` | Message |
| `messageLabel` | Your message |
| `charactersLeft` | {n} characters left |
| `screenshot` | Screenshot |
| `record` | Record screen |
| `recordNote` | A recording stops if this page reloads or you leave it. (`''` hides it; shown where a recording cannot follow) |
| `recordNoteFollows` | The recording follows you from page to page on this site. It stops if you leave the site. (shown where it can) |
| `recordingLeft` | The recording stopped because the next page is on another site. That page opens when you send or close this. |
| `recordingBlocked` | The recording stopped because this site does not let the next page be shown in a frame. That page opens when you send or close this. |
| `screenshotCaption` | Screenshot of this tab |
| `recordingCaption` | Recording, {duration} |
| `remove` | Remove |
| `recording` | Recording (the recording pill's name) |
| `stop` | Stop |
| `onlyThisTab` | Only this tab can be captured. Choose this tab when the browser asks. |
| `anySurfaceNote` | This browser shares a whole window or screen, not only this page. Check the preview before you send. (under the buttons, only where the browser cannot promise this tab) |
| `captureFailed` | The screen could not be captured. |
| `recordingTimeLimit` | The recording stopped at its time limit. |
| `recordingSizeLimit` | The recording stopped at its size limit. |
| `alsoSent` | Also sent: {list}. |
| `sentFields` | Sent with it, as form fields: {list}. (under the expanded report, when `fields` is set) |
| `sentAddress` | this page's address |
| `sentBrowser` | your browser |
| `sentErrorsOne` | {n} console error |
| `sentErrorsOther` | {n} console errors |
| `sentRequestsOne` | {n} recent request |
| `sentRequestsOther` | {n} recent requests |
| `sentPagesOne` | {n} page visited |
| `sentPagesOther` | {n} pages visited |
| `sentUser` | your name as this page knows it |
| `sentContext` | details this site adds |
| `showReport` | Show exactly what is sent |
| `hideReport` | Hide what is sent |
| `cancel` | Cancel |
| `send` | Send |
| `sending` | Sending… |
| `retry` | Retry |
| `close` | Close |
| `sent` | Sent. |
| `sentWithId` | Sent, #{id} |
| `thanks` | Thank you. Your report was sent. |
| `failed` | It could not be sent. Check your connection, then retry. |
| `invalid` | The report was refused. Check it, then send again. |
| `outdated` | This page is out of date. Reload it, then send again. Your message is kept. |
| `signIn` | Sign in again, then send. Your message is kept. |
| `tooLarge` | The report is too large to send. |
| `unsupportedMedia` | An attachment is a kind of file that cannot be received. |
| `sendWithoutScreenshot` | Send without the screenshot |
| `sendWithoutRecording` | Send without the recording |
| `rateLimited` | Too many reports were sent. Try again later. |
| `rateLimitedUntil` | Too many reports were sent. Try again after {time}. |
| `disabled` | Feedback cannot be received at the moment. Your message is kept; try again later. |
| `refused` | The report was refused ({status}). |

The `One` and `Other` pairs are chosen by `Intl.PluralRules` for the locale; the "Also sent" list
is joined by `Intl.ListFormat`.

`recordNote` is shown under Record where a recording cannot follow the person to another page
(`video.follow` false, or a browser without the Navigation API): there a recording lives in the
page, and a single-page app records across its own route changes only. `recordNoteFollows` is
shown instead where it can.

## Theming

The panel lives in a shadow root: your CSS cannot reach into it and its CSS cannot leak out. It
takes six custom properties from your page, which cross the shadow boundary by design:

```css
:root {
  --feedback-accent: #0f766e;   /* the Send button, the picked type, focus rings. Default #2563eb */
  --feedback-accent-text: #fff; /* text on the accent. Default: chosen for you, see below */
  --feedback-surface: #ffffff;  /* the panel's background. Default #ffffff, #1c1c1f in dark */
  --feedback-text: #1f2328;     /* the panel's text. Default #1f2328, #ececee in dark */
  --feedback-radius: 12px;      /* the panel's corners */
  --feedback-font: system-ui, sans-serif;
}
```

Muted text, borders and hover tints are mixed from the text and surface colors, so they follow
yours. A value you set applies in both themes; to vary it, set it inside your own
`prefers-color-scheme` media query.

Text on the accent (Send, the picked type, Stop) is `--feedback-accent-text` when you set it.
When you do not, the panel reads the accent as your page resolves it each time it opens and uses
whichever of near-black (`#111111`) and white has the higher contrast against it, so the pair meets
4.5:1 wherever either can: the default blue keeps white text, a teal such as `#17a2b8` (about 3:1
with white) gets near-black. The accent is otherwise used only as a fill and as the focus ring.
When the accent is under 3:1 against the panel's surface (a pale accent in the light theme, a deep
one in the dark), focus rings are drawn in the text color instead and the accent-filled controls
get a thin edge, so neither depends on the accent being visible against the surface.

The launcher is drawn by the stub, which has no room for that check: its text is
`var(--feedback-accent-text, #fff)`. A page with a light accent that uses the launcher sets
`--feedback-accent-text` itself.
`theme: 'light'` or `'dark'` forces one scheme whatever the system prefers.

The look is meant to be quiet in any product: system fonts, one accent, no gradients, no icons.
The panel is never taller than the window: the title and the Cancel and Send row stay in view and
the part between them scrolls, and a refusal arriving is scrolled into view with its offer.
At 480 px wide and below the panel is a bottom sheet; it works at 320 px and with touch (44 px
targets on coarse pointers). The launcher, when drawn, is a plain button styled from script with
the same accent and font.

## Content Security Policy

The widget needs no `unsafe-inline` and no `eval`. The panel's styles are a constructable
stylesheet adopted by its shadow root, which `style-src` does not govern; the launcher is styled
through the element's style properties from script, which a strict policy allows (a `style`
attribute in markup would not be). There is no `<style>` element, no inline handler and no
`innerHTML` anywhere.

A page with a policy needs:

| Directive | Needs |
|---|---|
| `script-src` | the origin serving the two files, or a nonce on the stub's tag (the panel's script element gets the same nonce), or the hashes of both files (with `panelIntegrity` set to the panel's) |
| `connect-src` | the endpoint's origin, and only it: the policy, not the widget, is what pins where reports can go |
| `img-src` | `blob:`, for the screenshot's thumbnail |
| `media-src` | `blob:`, for the recording's preview |
| `frame-src` (or `child-src`) | `'self'`, for a [recording across pages](#recording-across-pages) only; without it the recording stops at the next page and the panel says the site does not let that page be shown in a frame (`recordingBlocked`) |
| `trusted-types` | `feedback`, on a page that sets `require-trusted-types-for 'script'`: the widget's one policy, which can give only the panel's address and the frame's empty starting document. Not allowed, the panel does not load, with one console error naming the policy |
| `Permissions-Policy` | `display-capture=(self)`, the default; a page inside an iframe needs `allow="display-capture"` on its frame |

The tests prove this on a page served with
`default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; style-src 'none'`:
the panel opens, is styled, takes a screenshot and a recording, and sends, with no violation
reported. On the multi-page test site under the same policy plus `frame-src 'self'` a recording
follows to the next page with no violation, and without `frame-src` it stops there and says why.
Under `require-trusted-types-for 'script'` with `trusted-types feedback` the panel opens and a
recording makes its frame; with another policy name allowed, it does not open and says so.

What a policy cannot do for the widget: the stub runs in the page's own world, so a script of the
page (or one injected into it) can read what the widget holds, change its settings before they
freeze, or replace its functions. The widget defends itself against a careless page (a polluted
`Object.prototype`, a clobbered `document.title`, a second copy) but not against a hostile script
on the same page; nothing running there could.

## Accessibility

- The panel is a modal dialog (`role="dialog"`, `aria-modal="true"`) named by its title. Focus
  moves into it on open (to the type buttons, or to the message when a type is already picked)
  and back to whatever opened it on close. When that element is gone, hidden or disabled (an item
  of a menu that closed, a button in a modal that closed), focus goes to what names its container
  (the nearest ancestor's `aria-labelledby`, as a menu names its toggle) or controls it
  (`aria-controls`); with neither, it is left on the page's body.
- Tab and Shift+Tab stay inside the panel; Escape closes it. Closing keeps the draft. A click on
  the dimmed page closes it too.
- The type buttons are a radio group: one Tab stop, the arrow keys move and pick (reversed left
  and right in a right-to-left locale).
- Every control has a visible word. The message box has a visible label; its counter is tied to it
  with `aria-describedby`. Refusals and failures are written into a `role="alert"` region, capture
  notices into a `role="status"` one, and the sent state is a status.
- Text meets 4.5:1 against its background in both themes with the default colors (the tests
  measure it).
- Under `prefers-reduced-motion` nothing animates.
- While recording, the panel shrinks to a small pill in the corner (a dot, the elapsed time,
  `Stop`) and the page is fully usable. Focus goes back to what opened the panel when it is still
  there, and otherwise stays on the page's body (never on a stand-in such as a menu's toggle), so
  typing (a barcode scanner's keys and Enter included) reaches the page's own handlers and never
  presses Stop; the pill is the last Tab stop on the page and announces "Recording" through a
  `role="status"` region.
  Escape does nothing to it, so a recording is never thrown away by a stray key; `Stop` ends it and
  the panel comes back with the recording playable.
- `locale` sets `dir` and `lang` on the panel.

### Over a host page's own dialog

The panel can be opened over a dialog of the page's own, a recording's Stop included. While the
panel or the recording pill shows, focus events inside the widget are stopped by a capturing
listener on `window`, which runs before any listener on `document` whatever the order they were
added in, so a script focus trap (Bootstrap's modal, jQuery UI's, a hand-written one, jQuery's
delegated `focusin`) never sees them and never pulls focus back. Focus that does leave the open
panel is brought back once and never chased, so two traps cannot call each other. A trap the page
adds as a capturing listener on `window` before the panel opens runs first and can still take
focus; the panel then simply loses it, without an error. Escape closes the panel only, and focus
goes back to whatever opened it, where the page's trap works as before.

A native `<dialog>` opened with `showModal()` makes the rest of the page inert, the widget
included. When one is open, the panel shows inside a modal `<dialog>` of its own, above it in the
top layer (the browser's dialog backdrop adds a light extra dimming), and the recording pill is put
inside the page's dialog, so the dialog stays usable while recording. If the page's dialog closes
during a recording, the pill moves back to the body.

## Privacy: what is collected and scrubbed

The report carries what the [report table](#the-report) lists and nothing else: never cookies,
storage, the page's HTML, form values, keystrokes, or request or response bodies. Other pages
appear only in a [recording across pages](#recording-across-pages), and then only the ones the
person visited during it (their addresses and titles in `pages`, and their errors and requests),
all scrubbed the same way. The panel shows "Also sent: this page's address, your browser, 3 console errors, 12
recent requests" and expands to the exact report as text, so a person sees what goes before it
goes. The expanded text is rebuilt while it is open as errors and requests arrive, and the
`fields` sent beside the report are named under it.

The stub keeps the last `errorBufferSize` entries of: uncaught exceptions, unhandled promise
rejections, failed script, image and stylesheet loads, and `console.error` and `console.warn`
calls. A message is cut to 500 characters and a stack to 2,000 when it is caught, and an entry
repeated in a row only counts up, so the buffer stays small however badly a page misbehaves. An
object passed to the console is written as JSON when it holds at most 300 values in all, and as
`[object]` otherwise or when it cannot be read (a revoked proxy, a getter that throws); the
wrapper never throws into the page's own call.
`console.log`, `info` and `debug` are not watched. The widget's own warnings bypass its buffer.

Recent requests come from the browser's resource-timing buffer at the moment of sending: the same
origin only, the newest `requestCount` with failed ones kept ahead of the rest, the widget's own
files and earlier reports left out (a recording across pages adds each page's, collected as it
went). The
widget never wraps `fetch` or `XMLHttpRequest`, so methods and bodies are unknown. The browser's
buffer holds 250 entries by default; on a busy page the oldest are gone. `status` is present only
where the browser reports one.

### Scrubbing

The panel scrubs while it builds the report, before the preview is drawn, so the preview is
exactly what is sent:

- In every URL (the page, the referrer, each request, each page visited, an error's source, and
  any URL inside an error's message or stack, relative ones such as `/api/login?token=…`
  included), the value of a parameter whose name matches the built-in names or `scrubParams`
  becomes `…`, and a `user:password@` part becomes `…@`. A parameter is any `name=value` in the
  URL, so one nested in another's value (`?next=/cb?token=…`) is found too, and a value runs to the
  next `&`, `#` or `?` (`?token=abc;def` loses all of `abc;def`). A name matches when
  it equals an entry (ignoring case) or one of its words does, words being split at `_`, `-`, `.`
  and lower-to-upper case changes: `access_token`, `apiKey`, `X-Amz-Signature` and `auth_code`
  are scrubbed, and `barcode`, `keyword` and `author` are not.
- In any text, the same names as `"name": "value"` (JSON) or `name=value` lose their value.
- The built-in patterns: `Bearer` or `Basic` followed by a credential (an `Authorization` header
  written into a message); a JWT (`eyJ…` in three dotted parts); and 13 to 19 digits that pass the
  Luhn check a card number passes, written together or in groups separated by single or double
  spaces, no-break spaces, dots or dashes, and found even beside other digits or letters (`order
  12 4111…`, `cc4111…`); a 13-digit timestamp almost always fails the check and is kept.
- Then each of `scrubPatterns`.

They run over error messages, sources and stacks and over URLs. Each text is cut to its cap
(8,000 characters at most) before it is scrubbed, so the work is bounded and nothing past the
cut is sent. The person's own message, the title, `context` and `user` are sent as given: the
person sees the message, and the other two are yours.

What scrubbing cannot catch. It is a net for the common cases, not a guarantee: a secret in a URL
path segment (`/reset/9f8a…`) or a hash route written like one (`#/invite/9f8a…`), a URL encoded
inside another (`?next=%2Fcb%3Ftoken%3D…`), a vendor's key format with no name beside it (`sk_live_…`,
`AKIA…`), a name not on the list, and anything visible in a screenshot or recording. A page that
handles such values sets `scrubParams` and `scrubPatterns` for them, removes what it must in
`beforeSend`, or sets `collect: {errors: false}` (and `requests: false`) so its errors and
requests are not sent at all; a page showing them on screen sets `screenshot: false, video: false`.

### The draft

While the panel is open the typed message, the picked type and the report's `id` are kept in
`sessionStorage` (key `feedback.draft`), so a reload, or a sign-in after a 401, does not lose
them. The panel reads it when it opens; the stub never does. It is stored with the `user.id` it
was typed under and thrown away when the panel opens under another. A successful send and
`feedback.reset()` remove it. Attachments are never written to storage.

## The protocol

Version 1. This section is the whole contract between the widget and a receiver; a project
implementing its own receiver needs to read nothing else.

### The request

One `POST` to `endpoint`, `multipart/form-data`, UTF-8. One request carries the whole report, so
it is stored or it is not; there is no upload step to leave half done.

| Part | Kind | Content |
|---|---|---|
| each key of `fields` | text field | as configured; the widget gives them no meaning |
| `report` | text field | the JSON document below |
| `screenshot` | file, optional | `image/webp`, `image/jpeg` or `image/png`, named `screenshot.<ext>` |
| `video` | file, optional | `video/webm` or `video/mp4`, named `video.<ext>` |

The parts come in that order. `report` is a plain text field, not a file part with a JSON content
type, so it arrives where a framework puts form fields (`$_POST['report']`, `req.body.report`) and
never among the uploads.

With the default settings the request has no custom headers and is what browsers call a simple
request: a cross-origin receiver gets no preflight. Setting `headers` adds one. The request is
made with `redirect: 'error'` and the configured `credentials`.

### The report

Every time is ISO 8601 in UTC with milliseconds, every duration is milliseconds, every size is
bytes, every pixel size is `[width, height]`. A field marked optional is absent when it has no
value, never null or empty, and a block switched off in `collect` is absent. The widget keeps the
whole document under 256 KB by the caps in the last column (dropping stacks first, then the oldest
errors and requests, then `context`, if it must), and nothing in it nests deeper than 16 levels: a
`context` that is deeper, or over its cap, is left out with one console warning.

There are eight required fields: `schemaVersion`, `id`, `widgetVersion`, `type`, `message`, `url`,
`openedAt` and `sentAt`.

| Field | Type | | Meaning | Cap |
|---|---|---|---|---|
| `schemaVersion` | integer | required | `1` | |
| `id` | string | required | A UUID the widget makes when the panel opens. The same on every retry of the same report | 36 |
| `widgetVersion` | string | required | The widget's semver | 20 |
| `type` | string | required | One of the configured `types`. A receiver keeps its own list of the types it takes | 20 |
| `message` | string | required | What the person typed, plain text, as typed; never empty or only whitespace | `messageMaxLength` |
| `url` | string | required | The page's address, [scrubbed](#scrubbing) | 2,000 |
| `title` | string | optional | `document.title` | 200 |
| `referrer` | string | optional | The page before, [scrubbed](#scrubbing) | 2,000 |
| `openedAt` | time | required | When the panel was opened | |
| `sentAt` | time | required | When Send was pressed | |
| `project` | string | optional | The `project` setting | 50 |
| `environment` | string | optional | The `environment` setting | 30 |
| `release` | string | optional | The `release` setting | 40 |
| `user` | object | optional | The `user` setting, `{id, name}`. A claim by the page, not an identity | 200 each |
| `context` | object | optional | The `context` setting as the host gave it | 16 KB |
| `client` | object | optional | Below | |
| `errors` | array | optional | Below, oldest first | `errorBufferSize` entries |
| `requests` | array | optional | Below, oldest first | `requestCount` entries |
| `pages` | array | optional | The pages visited while a recording ran, oldest first, each `{url, title, at}`; present only when there was more than one | 50 entries |
| `attachments` | object | optional | Below; one key per file part present | |

`client`: `userAgent` (string), `language` (string), `timeZone` (IANA name), `viewport`, `screen`
(pixel sizes), `pixelRatio` (number), `online`, `touch` (booleans).

An entry of `errors`:

| Field | Type | Meaning |
|---|---|---|
| `kind` | string | `exception` (uncaught), `rejection` (unhandled promise), `resource` (a script, image or stylesheet failed to load), `console.error`, `console.warn` |
| `message` | string | Up to 500 characters |
| `source`, `line`, `column` | string, integer, integer | Optional; where it was thrown. `source` up to 2,000 characters, scrubbed as a URL |
| `stack` | string | Optional; up to 2,000 characters |
| `at` | time | The first time it happened |
| `count` | integer | How many times in a row the same entry repeated; `1` when it did not. A loop that throws fills one entry, not the buffer |
| `page` | string | Optional; the address of the page it happened on, when the report covers more than one. Up to 2,000 characters, scrubbed as a URL |

An entry of `requests`: `url` (string, [scrubbed](#scrubbing), up to 2,000 characters), `status`
(integer, optional: absent where the browser does not report it), `ms` (duration), `at` (time),
`page` (string, optional, as on an error). Failed requests are kept ahead of the rest when there
are more than `requestCount`, since across several pages the newest are all the last page's
scripts and styles. They are read from the browser's own resource-timing buffer at the moment of
sending (and, for a page the recording went through, when that page went), so the widget wraps
neither `fetch` nor `XMLHttpRequest`, and the method and bodies are not known and not sent.

`pages`: the pages visited while a recording ran, oldest first, each `{url, title, at}` (the
address scrubbed like every other, the title up to 200 characters, `at` when the page arrived),
at most 50; present only when there was more than one. The report's own `url` and `title` are the
page the person was on when they sent it.

`attachments` says what the widget believes it attached, so a receiver can show a size or a
duration without opening the file, and can tell a file its proxy stripped from one never sent:

```json
"attachments": {
  "screenshot": {"type": "image/webp", "bytes": 184220, "size": [1440, 812], "surface": "browser"},
  "video": {"type": "video/webm", "bytes": 1903344, "size": [1280, 720], "ms": 41200, "frameRate": 5, "surface": "browser"}
}
```

`surface` (optional, since widget 1.2.0) is what was captured, as the browser's track reported it:
`browser` (a tab: this tab, wherever the browser can promise it), `window` or `monitor` (a whole
screen). It is absent when the browser reports nothing, which Firefox does today; a capture
without it is whatever the person picked in the browser's picker, so a receiver shows it as
possibly more than the page.

That is everything. The widget never sends cookies' contents, storage, the page's HTML, form
values, keystrokes, request or response bodies, or anything about pages other than the one the
panel was opened on.

A whole report:

```json
{
  "schemaVersion": 1,
  "id": "0b9f6c1e-7d55-4a53-9a55-3f1c2f6f1a10",
  "widgetVersion": "1.2.0",
  "type": "bug",
  "message": "Save on the product page does nothing after I change the weight",
  "url": "https://shop.example/product/4417?tab=shipping",
  "title": "Product 4417",
  "referrer": "https://shop.example/products",
  "openedAt": "2026-11-23T15:02:41.000Z",
  "sentAt": "2026-11-23T15:04:05.000Z",
  "project": "shop",
  "environment": "production",
  "release": "a1b2c3d",
  "context": {"app": "desktop"},
  "client": {
    "userAgent": "Mozilla/5.0 …", "language": "en-US", "timeZone": "America/New_York",
    "viewport": [1440, 812], "screen": [1920, 1080], "pixelRatio": 1, "online": true, "touch": false
  },
  "errors": [
    {"kind": "exception", "message": "TypeError: Cannot read properties of undefined (reading 'weight')",
     "source": "https://shop.example/product.js", "line": 212, "column": 9, "stack": "…",
     "at": "2026-11-23T15:03:12.000Z", "count": 1}
  ],
  "requests": [
    {"url": "https://shop.example/api/product/4417", "status": 500, "ms": 412, "at": "2026-11-23T15:03:11.000Z"}
  ],
  "attachments": {
    "screenshot": {"type": "image/webp", "bytes": 184220, "size": [1440, 812]}
  }
}
```

### The answer

Success is any 2xx. The body may be empty, or JSON with either or both of:

```json
{"id": "123", "message": "Thanks, we read every one."}
```

`id` is the receiver's own reference, shown to the person as "Sent, #123". `message` replaces the
widget's own thank-you line.

A refusal is a 4xx or 5xx whose body is, when the receiver can manage it:

```json
{"error": {"code": "tooLarge", "message": "The recording is larger than 12 MB.", "field": "video"}}
```

`message` is written for the person and shown as it is. `field` names the part or report field at
fault when there is one. The widget acts on `code` when present and on the status alone when the
body is missing or not JSON, which is what a proxy in front of the receiver sends (a web server's
own 413 page is HTML).

| Status | `code` | Meaning | The widget |
|---|---|---|---|
| 400, 422 | `invalid` | A required field is missing or wrong | Shows the message, keeps the form |
| 400 | `unsupportedVersion` | The receiver does not take this `schemaVersion` | Says the page is out of date and to reload |
| 401, 403 | `unauthorized` | No session, or not allowed | Says to sign in again; keeps the draft across the reload |
| 413 | `tooLarge` | The request or one part is too big | Offers to send without the part named in `field`, or without the recording when none is named |
| 415 | `unsupportedMedia` | A file is not a type the receiver takes | The same offer |
| 429 | `rateLimited` | Too many reports | Says to try again later, at the time in `Retry-After` when given |
| 503 | `disabled` | Feedback is switched off | Says so; the draft is kept |
| other 5xx, no answer, timeout | | Failed | Says it could not be sent and offers Retry |

Three allowances for receivers behind an existing dispatcher: a 200 whose body has an `error` key
counts as a refusal; the text is taken from `error.message`, else `error.msg`, else a top-level
`message`; and an `error.code` that is a number is read as the HTTP status the dispatcher did not
set. An `error` that is null or false is not a refusal (success envelopes carry one), and an
`error` that is a bare string is the text. So
`{"error": "Authentication required", "authRequired": true}` with a 401 lands on the 401 row.

However it arrives, the text is shown as text, cut to 300 characters, never as HTML. The request
is made with `redirect: 'error'`: a receiver that answers with a redirect is a failure, because
following a 307 would post the report and its files to wherever the redirect points.

The widget never retries by itself. Retry is the person pressing a button, and the retry carries
the same `id`.

How this widget reads the table, in the details a receiver might ask about:

- Every row but success keeps the form, the draft and the attachments. Success clears them, and
  the next report gets a new `id`.
- Where the receiver sent text, it is shown in place of the widget's own line, except that on the
  401/403 row "Sign in again, then send…" follows it, and on the 429 row "Try again after 15:04"
  follows it when `Retry-After` was given. On the failure row the widget's line comes first and the
  receiver's text after it.
- The offer on a 413 or 415 is a button, "Send without the screenshot" or "Send without the
  recording". It names the part in `field` when that part is attached; with no `field` it names
  the recording if there is one, else the screenshot; with a `field` naming anything else, or
  nothing attached, there is no offer. Pressing it removes that attachment and sends again with
  the same `id`.
- A 2xx with an `error` and a numeric `error.code` from 400 to 599 is read as that status; with
  any other code it is read as a 400 and then by its `code`.
- An unknown 4xx (404, 405, 409, …) shows the receiver's text, or "The report was refused (404).",
  and keeps the form. An unknown 5xx is a failure.
- A 503 is the `disabled` row whether or not it has a body.
- `Retry-After` is read as seconds or as an HTTP date and shown in the person's locale. A
  cross-origin receiver must list it in `Access-Control-Expose-Headers` for the page to see it.
- A redirect, a dropped connection, a CORS refusal and the `timeoutMs` running out are all
  "no answer": the failure row, with Retry.

### What a receiver must do

- **Know the sender itself.** Identity comes from the receiver's session or token, never from
  `user` in the report.
- **Refuse a forged post.** A receiver that trusts a cookie session checks that `Origin` (or
  `Sec-Fetch-Site`) is its own before storing, or requires a CSRF token the host supplies through
  `fields` or `headers`. A multipart POST is a request another site's page can make.
- **Store a given `id` once per sender.** A second request from the same sender with an `id`
  already stored answers 2xx with the first one's `id` and stores nothing, so a retry after a lost
  answer is not a duplicate. The check is scoped to the sender, so one person's `id` can neither
  block nor reveal another's. An `id` that is not a UUID is `invalid`.
- **Stamp its own facts.** When the report arrived, who sent it and what version the server was
  running come from the receiver. `sentAt`, `release`, `url` and everything else in the report are
  the page's claims: useful, shown as such, never the basis of a decision.
- **Re-apply the caps.** Lengths and entry counts are cut to the protocol's caps on arrival; the
  widget's own trimming is not relied on. A report nested deeper than 16 levels, or a `context`
  over its cap, may be refused (`invalid`, `tooLarge`) instead of cut.
- **Enforce its own limits** on the report's size, each file's size and type, and the rate,
  whatever the widget was configured with. A file's type is read from its bytes, not from the
  part's header or `attachments`.
- **Treat every string as untrusted text.** Store it, escape it where it is shown, never render it
  as HTML, never fetch a URL in it from the server. A URL from the report becomes a link only when
  its scheme is `http` or `https`; anything else (`javascript:`, `data:`) is shown as text.
- **Treat every file as hostile bytes.** Keep it outside the web root under a name the receiver
  made; accept only the listed types, by content, and never SVG; refuse an image over 8,192 pixels
  on a side; never run it through a converter. Serve it only to whoever may read reports, with the
  stored type, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none';
  sandbox`, so a file that is also valid HTML cannot run in the reader's session.
- **Remember what a report can carry into the next tool.** Text copied to a tracker or handed to
  an AI session is still the sender's text: it goes inside a fenced block marked as submitted
  content, never inline with the tool's own instructions.
- **An open receiver is a public upload endpoint.** One with no sign-in limits by address as well
  as by origin (a script can send any `Origin`), takes smaller files or none, and expects spam.
- **Ignore what it does not know.** An unknown field or part is not an error.
- **Cross-origin only:** answer CORS for the origins on its own allowlist, never `*` with
  credentials, and expose `Retry-After` if it sends one.

### How the protocol changes

A new optional field, `kind`, `code` or file type is a minor version of the widget and leaves
`schemaVersion` alone; receivers already ignore what they do not know, and the widget treats an
unknown `code` by its status. Removing a field, changing a type or meaning, or making an optional
field required is a new `schemaVersion`. The widget sends one version; a receiver may take several.

## Example receivers and the conformance check

- `examples/receiver.php` and `examples/receiver.js`: a minimal receiver in PHP and in Node, about
  a hundred lines each, with no dependencies. They read the `report` field and up to two files,
  check them and write them to a directory. `examples/README.md` says how to run them and what they
  leave out before either faces the internet.
- `tests/conformance.js`: a command-line check that posts every case of the protocol to a
  receiver and prints pass, fail or "check by hand" for each, so you know your endpoint is right
  before a page loads the widget. Plain Node 18 or later, nothing to install:

  ```sh
  node tests/conformance.js https://your.site/api/feedback
  ```

  A receiver behind a dispatcher or a session is reached with `--field name=value` (the widget's
  `fields`), `--header 'Name: value'` (a cookie or token) and `--origin <the page's origin>`, which
  also runs the forged-origin case. `--type <type>` sets the type the valid cases use, `--only
  <case>` runs one case, `--list` names them, `--keep` leaves the messages unmarked (by default each
  starts with `[conformance]` so the reports can be found and deleted), and `--json` prints one JSON
  document. The header comment of the file is the reference. A full run stores about ten reports.

## Recording across pages

The capture belongs to the document that started it, so on a site where each link loads a new
page, a link click would end a recording. While a recording runs, the widget therefore keeps that
document: a navigation that would replace it is cancelled (the Navigation API's `navigate` event)
and its destination is loaded in a same-origin frame laid over the page. Once that page has
arrived the frame is shown, and the person carries on inside it, where later navigations happen
by themselves. The pill stays where it was, the this-tab-only check is untouched because the top
document is still the one captured, and the address bar, the title and the Back button follow the
framed page. One real video, one browser prompt.

What it follows: link clicks, navigations by script, GET and POST forms (fields and files posted
by the frame instead), a POST answered with a redirect, Back and Forward through the pages visited
(Back from the first visited page shows the page the recording began on, exactly as it was, with
its scroll and what was typed), a reload by script, downloads, links to a new tab, hash links,
addresses pushed by script, and links aimed at the whole window (`target="_top"`).

What it cannot hold: the browser's own Reload button, a typed address, and Back past the page the
recording began on. The browser never offers those to a page, so while there is a recording,
running or kept, the widget asks "Leave site?" first; Stay keeps everything, Leave ends it as
before. Navigations the covered page asks for by itself (its timers reloading it or sending it
elsewhere) are dropped, and so is a framed page's script sending the whole window somewhere,
since the two cannot be told apart; a person's own click aimed at the whole window is followed.

Leaving the site ends the recording. A navigation to another origin (a direct link, or a
same-origin address that redirects there, or a page that refuses to be framed) stops it, keeps
what was recorded, and says so in the panel (`recordingLeft`); the window goes to that address
once the panel is closed.

After Send or Cancel the person stays where they are, in the frame, with what they typed and their
place on the page, and an unsent recording stays in the panel. The window goes for real at their
next GET navigation out of the framed page (a link, a GET form, a script setting the address):
that navigation starts in the frame like any other, and once it commits there the frame goes blank,
its history is wound back, and the window loads the page. So the person sees the page they were on,
a blank moment and the new page, never the new page twice; and the new page is requested twice,
once by the frame (its load cut short) and once by the window. A navigation that never commits
stays in the frame: a download arrives and the person is where they were, a 204 does nothing, and
Stay at a page's own "Leave site?" keeps them there with what they typed, after which the next
navigation leaves as before. A POST from the framed page is followed in the frame, and the window
goes at the next GET. Back from the new page is the page the recording began on, with no dead steps
between. Back to the first page instead, and the next link from there is gone to for real.

While a recording or a screenshot is held unsent (after Cancel), nothing exits: the frame keeps
following, so the attachment survives until it is sent or removed.

Some ways out cannot be steered. The browser's own Reload, a typed address and a restored tab load
the address shown, which is the framed page's, for real: the person lands on that page, the page
the recording began on is no longer in the tab's history behind it, and the framed pages' steps
stay behind as Back presses that do nothing, one for each. With a recording running or held, Reload
and a typed address ask "Leave site?" first. A link to the very address the recording began on
leaves one Forward press that does nothing.

The page the recording began on stays alive beneath the frame until the window leaves it: its
timers, sockets and polling keep running, and a server that counts open pages counts it. Its
content is made `inert` while covered, and the keyboard goes back to it when it is shown again.
What it puts in the top layer by itself while covered (a modal `<dialog>` its script opens, a
popover left open at the change) stays beneath the frame, which is raised above it with the
keyboard. Printing while framed prints the framed page at its full height, without the covered
page. The frame's own `<dialog>` is exposed to assistive technology as nothing (`role="generic"`,
since Chrome exposes a dialog whatever `none` or `presentation` say), so the framed page reads as
the page; the pill stays the last Tab stop after it.

Every page visited is in the report: `pages` lists them, each error and request carries the
`page` it came from, and the report's `url` and `title` are the page the person sent it from. A
framed page's errors and request timings are collected when it goes (`pagehide`).

Requirements on the host:

- The site's own pages must be framable by the site itself: no `X-Frame-Options: DENY` and no
  `Content-Security-Policy: frame-ancestors 'none'` (`SAMEORIGIN` and `'self'` are fine). A page
  that refuses is treated as leaving the site.
- A page with a Content-Security-Policy allows its own pages in a frame: `frame-src 'self'` (or
  `child-src`), see [Content Security Policy](#content-security-policy). Without it the recording
  stops at the next page, keeps what was recorded and says the site does not let the page be shown
  in a frame (`recordingBlocked`); the window goes there once the panel is closed.
- A framed page from the same origin runs the stub in adopted mode: it hands its error buffer to
  the widget of the page above, draws no launcher, never fetches the panel, and a press on its
  trigger opens the one panel above. Its `feedback.open()`, `close()`, `setContext()` and
  `reset()` reach that panel too, so a sign-out on a framed page clears the draft and an unsent
  recording. A stub framed by another site's page is an ordinary stub and touches nothing above.
- Over a native modal `<dialog>` of the page, the frame goes into the top layer with it.

`video.follow: false` installs nothing. Where the Navigation API is missing (Firefox and Safari at
the time of writing, which have no this-tab capture either) nothing is installed and a recording
ends at the page change, which the note under Record says.

## Browser support

The widget is written for current browsers: Chrome and Edge 111+, Firefox 113+, Safari 16.4+
(constructable stylesheets, `color-mix()`, regular-expression lookbehind). Those floors are read
from the features used; the tests run in Chrome, and the parts that differ in Firefox run in Firefox
too. Where constructable stylesheets are
missing the panel refuses to open and says so in the console; the stub still runs harmlessly.

Following a recording across pages needs the Navigation API (`window.navigation` and
`NavigateEvent`): Chromium-based browsers. Elsewhere a recording ends at the page change.

Screen capture needs `navigator.mediaDevices.getDisplayMedia`, which Android Chrome, Android and
iOS WebViews and iOS Safari do not have. There the Screenshot and Record buttons are absent and a
report is the message, the context and the errors. Recording also needs `MediaRecorder` with WebM
(VP9 or VP8) or MP4.

Where the browser can capture this tab and say so, capture is this tab only. That is decided at
every press from what the browser reports, never from its name: `getSupportedConstraints()` lists
`displaySurface` (Chrome and Edge today). The widget then asks with
`getDisplayMedia({video: {displaySurface: 'browser'}, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude', audio: false})`,
and whatever the person picks, a stream whose video track does not report
`getSettings().displaySurface === 'browser'` is stopped and thrown away with the line "Only this
tab can be captured". That proves the stream is a browser tab, not that it is this one: in a
browser whose picker offers other tabs as well, a person who picks one sends that tab, and the
preview shows it before anything is sent.

Where the browser can capture but cannot promise a tab (it does not list `displaySurface`: Firefox
today, which offers a window or the whole screen), the buttons are shown with the note
`anySurfaceNote` under them, the widget asks with `getDisplayMedia({video: true, audio: false})`
(a recording adds its frame rate and width), and it takes whatever the person picks; the preview
before Send is the safeguard, as everywhere. This is a stopgap for browsers without this-tab
capture: the day a browser starts reporting `displaySurface`, the strict rule applies there by
itself, with no release of the widget. `anySurface: false` keeps the strict rule everywhere, hiding
the buttons where it cannot hold. Each attachment's `surface` says what was captured when the
browser reports it.

A screenshot is the picture of what was shared, at its own size, scaled down when its longer side
is over 3,840 pixels (two screens side by side, say) and again until it is under 4 MB, so it stays
inside a receiver's 8,192 pixels and 5 MB. A recording uses `video.maxWidth` and `video.frameRate`
whatever was shared.

A WebM recording is written by the browser as a live stream, with no length in it (Chrome writes
no Duration, Firefox a Duration of 0): players other than the recording browser show none and
cannot seek until they have played it through. The widget writes the length into the file's header
before attaching it (only the first few kilobytes are read and rewritten; Firefox's Duration of 0
is overwritten in place; a file not of the expected shape is left as it was), so the preview, a
receiver and a saved file all know it. An MP4 recording is left alone.

The browser asks the person to confirm what is shared every time; that prompt is the consent. The panel
hides itself for the screenshot's frame. A tab sends frames only when something on it changes, so
while waiting for that frame the panel flips one nearly transparent pixel in the corner; it can be
in the screenshot. A recording of a page where nothing moves can come out empty, which the panel
says ("The screen could not be captured").

## Size

The stub's budget is 4,096 bytes gzipped (`gzip -9`) as committed, unminified, and
`tests/idle.spec.js` holds it there. At 1.2.0 it measures 11,202 bytes raw and 4,091 bytes
gzipped (a minifier would take it lower, which a project may do; the budget is for the readable
file). The hardening against a polluted prototype, a second copy, markup-set endpoints and
Trusted Types took most of the headroom; what is left is for fixes, not features, and anything
new belongs in the panel. The weight is
spread over the duties the stub must have (the list of known setting names for the unknown-key
warning, the console wrap and error buffer, the checks of its six settings, the launcher, the
panel loader and the API).

What the stub costs at idle does not depend on its size: two error listeners, a wrap of
`console.error` and `console.warn`, one click listener and one `load` listener, and no timer,
observer, request, storage read, layout read or DOM write (unless `launcher` is set).

## Running the tests

The tests are Playwright, against static pages and a throwaway receiver (`tests/receiver.js`,
Node, no dependencies), with no other project involved. The receiver starts on a free port for
each run.

```sh
cd tests
npm install                         # @playwright/test 1.58.2, nothing else
npx playwright install chromium     # once, if you have no Chrome to use
npx playwright test                 # Playwright's own Chromium
FEEDBACK_TEST_CHANNEL=chrome npx playwright test   # the installed Google Chrome instead
```

Screen capture runs headless in Chrome and Chromium with two flags, which the config sets:
`--use-fake-ui-for-media-stream` (the permission prompt is accepted) and
`--auto-accept-this-tab-capture` (with `preferCurrentTab`, the current tab is chosen without the
picker). Either flag alone was enough with Chrome 152 headless; both are set. No virtual display
is needed; `FEEDBACK_HEADED=1` runs headed (under `xvfb-run` on a machine without a display) if
you want to watch. The refusal of a stream that is not this tab is tested with a stand-in
`getDisplayMedia` that returns a canvas stream reporting `monitor`, `window` or no
`displaySurface`, and a browser that cannot promise a tab with a stand-in
`getSupportedConstraints()` that lists no `displaySurface` (`surface.spec.js`).

The `firefox` project runs `firefox.spec.js` in Playwright's Firefox, beside the Chrome project
(`--project=chrome` or `--project=firefox` runs one). It needs that Firefox and Xvfb:

```sh
npx playwright install firefox      # on a Linux Playwright does not list yet (Ubuntu 26.04 here),
                                    # PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 in front
```

Firefox captures a real X display only, so `firefoxDisplay.js` (a second global setup) starts an
Xvfb of its own at 1280x800 on a free display number, and Firefox runs headed on it with
`GDK_BACKEND=x11`, so nothing opens on the desktop of the machine running the tests. One
preference is enough to capture without a person: `media.navigator.permission.disabled: true`
skips Firefox's sharing prompt, and Firefox then shares that whole screen, Firefox's own window on
it. Headless Firefox with no display never answers `getDisplayMedia`. Without Playwright's Firefox
or Xvfb the Firefox tests are skipped, saying which is missing.

`FEEDBACK_WIDGET_DIR=<directory>` makes the test receiver serve the two widget files from another
directory, to see a test fail on an older build; `FEEDBACK_EXAMPLES_DIR=<directory>` and
`FEEDBACK_CONFORMANCE=<file>` do the same for the example receivers and the conformance check.

`FEEDBACK_SCREENSHOTS=<directory>` also runs `screens.spec.js`, which writes pictures of the
panel's states (light, dark, 320 px wide, tall at 1280x600 and 320x568, the launcher with a custom accent, a teal accent with dark text, attachments, the
recording pill, an error, the too-large offer, sent) for a person to look at.

| File | Covers |
|---|---|
| `idle.spec.js` | The idle budget (no request, timer, observer, layout or storage read, or DOM change), the buffer and its caps, console chaining in both orders, a host restoring the console, loading the stub twice, the stub's size (at most 4,096 bytes gzipped) |
| `settings.spec.js` | Attributes, `init()`, precedence, the freeze, one warning per bad key, no endpoint, endpoint rules, the launcher, locale |
| `send.spec.js` | The request's shape, the required fields, whitespace-only messages, `context` depth and size, `user`, the length cap, requests |
| `report.spec.js` | Each `collect` switch, the "Also sent" line, `scrubParams`, the built-in and custom patterns, the preview, `beforeSend`, the 256 KB cap |
| `answers.spec.js` | Every row of the answer table, the dispatcher allowances, redirects, timeouts, dropped connections, Retry with the same `id` |
| `capture.spec.js` | A real screenshot and recording arriving as WebP and WebM by their bytes, each with `surface: 'browser'`, Remove, the time limit, Escape while recording, the this-tab-only refusal, absent buttons |
| `surface.spec.js` | In Chrome with stand-ins for a browser that cannot promise this tab: the buttons and the note shown, a `monitor` screenshot and recording taken and labelled in `attachments`, no surface claimed when none is reported, `anySurface: false` (from `init()` and the attribute) hiding the buttons, a bad `anySurface` warned, a 7680-pixel screen scaled to 3840, the strict path taken at the next press once the browser reports a tab surface; and a real Firefox WebM, whose Duration is 0, given its length in place so Chrome reads it |
| `firefox.spec.js` | In Firefox (the `firefox` project): what it reports for `displaySurface`; the buttons with the note and the single-page recording note; a real screenshot and recording of the shared screen arriving as WebP and WebM with a finite length; `anySurface: false`; open, send and close by keyboard; a link during a recording ending it with no error; Firefox's own WebM header and the length written into it |
| `keyboard.spec.js` | Keyboard only from trigger to sent and back, the Tab trap, Escape, the alert, contrast in both themes, reduced motion, focus returned to a menu's toggle when the trigger hid with its menu, and to the body when it was removed |
| `accent.spec.js` | Text on the accent chosen for contrast (a teal gets near-black, the default blue keeps white), a host's `--feedback-accent-text` winning on the panel and the launcher, focus rings in the text color when the accent is under 3:1 against the surface |
| `csp.spec.js` | The strict-CSP page; a recording across pages under it with and without `frame-src 'self'`; Trusted Types with the policy `feedback` allowed and not allowed |
| `hardening.spec.js` | A page that pollutes `Object.prototype` with every name the widget reads; an endpoint on another origin from an attribute and from `init()`; a second copy; cuts that would split a surrogate pair and a lone surrogate in `context`; the scrubber's cards, names in text, nested, relative and added names; `reset()` against an earlier request, a screenshot still being asked for, a send in flight and a panel still loading; focus while sending and after a refusal; the hub refusing a panel it did not load; a bad trigger, a launcher position that is not text, a stub with no `defer`, an inline stub; a console call with a revoked proxy, a throwing getter and 100,000 keys; a malformed `panelIntegrity`; a `MediaRecorder` that throws; the preview following late errors and naming `fields`; a `beforeSend` that never settles or returns too much or too little; a trigger in a shadow root; a clobbered `document.title`; no `displaySurface` with `anySurface: false`; launcher `zIndex` values |
| `draft.spec.js` | The draft across a reload, across users, and `reset()` |
| `security.spec.js` | The version handshake, `panelSrc` and `panelIntegrity`, a clobbered `currentScript`, the nonce, the stub's `?v=` carried to the panel |
| `modal.spec.js` | The panel over a page's modal: a Bootstrap-style `focusin` trap added before the stub loads, after the page loaded, or while the panel is open; a trap on `window` that runs first (no recursion); a native `showModal()` dialog. Focus stays in the panel, typing works, Escape closes only the panel, focus goes back into the modal and its trap works again, and the recording pill's Stop works by keyboard and mouse |
| `follow.spec.js` | A recording across pages, on the multi-page test site in `pages/site/` with a second origin on another port: links, script navigations, GET and POST forms (a file included), a POST answered with a redirect, Back and Forward (the first page as it was, Back past it asking to leave), reloads, new tabs, downloads, hash links, pushed addresses, a keyboard search, `target="_top"` and the covered page's own timers; leaving the site four ways; the report's `pages` and per-page errors and failed requests, the video covering the walk; staying in the frame after Send and leaving for real at the next link; Cancel keeping the recording; `video.follow: false` and no Navigation API; a foreign top; the time limit while framed; Stop while a page is on its way; typing after the swap; a trapped modal in the frame; a native modal dialog on the first page |
| `follow-exit.spec.js` | The exit from the frame after a report, and the lazy state's edges: a download, a 204 and a link to a section of the first page as the next navigation; the blank moment; Stay at a framed page's "Leave site?" (a link, then another site), then Back past it; Back to the first page then a link; a held recording surviving a link; a redirect to another site after three framed pages and the Back trail; `reset()`, `setContext()` and `close()` from a framed page; a second report without the first's errors; printing; a popover and a late modal dialog of the covered page; the Tab order; a host's `dialog[open]` rules; focus at the start of a recording; the recording's length in the preview and as received, and a malformed header left as it was |
| `tall.spec.js` | A panel taller than the window, at 1280x600 and 320x568 with both attachments: Send in view and clickable, a refusal and its offer scrolled into view |
| `examples.spec.js` | The real widget against both example receivers, `examples/receiver.js` under Node and `examples/receiver.php` under `php -S` (skipped, saying so, when PHP 8.2 or later is not on the path), each started on a free port with a fresh `FEEDBACK_DIR` and reached through `receiver.js`'s same-origin proxy (`/proxy/<port>/`, since the examples answer no CORS): a minimal report and a full one with a screenshot and a three-second recording, each answered 201 and stored exactly as sent, the files WebP and WebM; a retry answered with the first one's id; a recording across two pages. Posted to each straight: 503 `disabled` with no `FEEDBACK_DIR`, stored files readable by their owner only, an empty file field, five copies of one report at once stored once, an error's `source` cut, the depth edge the same in both. `conformance.js` against each (no failure; the new cases pass or ask for a hand check), and against a receiver built to answer the version case wrong |

Every test fails on an uncaught error in the page; a test that throws on purpose marks its error
`expected-in-test`.
