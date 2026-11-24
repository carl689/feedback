# Installing and configuring

The reference for loading the widget and for every setting, data attribute and call of its API.

## Install

Copy the two files, at the version you want, into your own static files and serve them from your
own origin. There is no shared CDN on purpose: no page of yours depends on someone else's host.

```
feedback.js         the stub, loaded by every page (about 11 KB, 4.0 KB gzipped)
feedbackPanel.js    the panel, fetched on the first press only, then cached
```

The repository has a `composer.json` (`carl689/feedback`), so a PHP project can also require it
with Composer from this repository and serve the two files out of `vendor/`.

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
[What a receiver must do](protocol.md#what-a-receiver-must-do), or start from an
[example receiver](../examples/README.md).

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
| `labels` | object of strings | `{}` | Any word the widget shows, by key; see [Labels](appearance.md#labels). A missing key falls back to English. |
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
| `scrubParams` | array of strings | `[]` | Parameter names whose values are replaced with `…`, added to the built-in ones: `token`, `key`, `secret`, `password`, `code`, `signature`, `auth`, `apikey`, `api_key`, `access_token`, `sid`, `sessionid`, `jsessionid`, `phpsessid`, `session`, `pwd`, `pass`, `sig`, `jwt`, `otp`, `authorization`. A list here never removes a built-in name. See [Scrubbing](security.md#scrubbing) for where and how a name matches. A URL's `user:password` part is always replaced. |
| `scrubPatterns` | array of `RegExp` or strings | `[]` | Extra regular expressions; every match in an error's message, source or stack and in every URL is replaced with `…`. A string is compiled with the `g` flag. The built-in patterns always run as well. |

### Capture

| Setting | Type | Default | Meaning |
|---|---|---|---|
| `screenshot` | boolean | `true` | `false` removes the Screenshot button. |
| `anySurface` | boolean | `true` | In a browser that can capture but cannot promise this tab (Firefox today), take whatever window or screen the person picks in the browser's own picker, with a note saying so. `false` keeps the strict rule everywhere: there the Screenshot and Record buttons are not shown. Where the browser can capture this tab it is this tab only, whatever this says. See [Browser support](recording.md#what-each-browser-does). |
| `video` | `false`, `true` or object | see below | `false` removes the Record button; `true` is the defaults. |
| `video.maxSeconds` | integer, 1 to 600 | `60` | A recording stops by itself after this long. |
| `video.frameRate` | integer, 1 to 30 | `5` | Frames per second asked of the browser. |
| `video.maxWidth` | integer, 320 to 3840 | `1280` | The widest frame asked of the browser. |
| `video.bitsPerSecond` | integer, 50000 to 8000000 | `250000` | The encoder's target. A minute at the defaults is about 2 MB. |
| `video.maxBytes` | integer, 100000 to 104857600 | `10485760` | A recording stops before it would pass this size (within about a second's worth), so nobody waits on an upload that will be refused. Your receiver enforces its own limit regardless. |
| `video.follow` | boolean | `true` | A recording keeps going when the person goes to another page of the site; see [Recording across pages](recording.md#recording-across-pages). `false` installs nothing, and a recording ends at the page change. |

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

The attributes are read only from the stub's own, real `<script>` element; what that means on a
page whose markup can be injected is in
[Privacy and security](security.md#a-page-whose-markup-can-be-injected).

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

## On sign-out

Call `feedback.reset()` when a person signs out. It empties the error buffer, removes the saved
draft from `sessionStorage`, closes the panel and discards the form and any screenshot or
recording, ends a recording across pages, and leaves out of later reports every request made
before it. Whatever was still under way is dropped when it finishes: a screenshot or recording
the browser was still asking for, a panel still loading (it does not open), and a send in flight,
whose answer is ignored (that request is not called back, so its report may still arrive at the
receiver). The next person at a shared terminal inherits none of it. A page that learns who signed in after
loading passes them with `feedback.setContext({user: {id, name}})`; a draft typed under another
`user.id` is discarded when the panel next opens.

## A host that wraps the console

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

## Browser support

The widget is written for current browsers: Chrome and Edge 111+, Firefox 113+, Safari 16.4+
(constructable stylesheets, `color-mix()`, regular-expression lookbehind). Those floors are read
from the features used; the tests run in Chrome, and the parts that differ in Firefox run in Firefox
too. Where constructable stylesheets are
missing the panel refuses to open and says so in the console; the stub still runs harmlessly.

Following a recording across pages needs the Navigation API (`window.navigation` and
`NavigateEvent`): Chromium-based browsers. Elsewhere a recording ends at the page change.

Screen capture has its own requirements; see [what each browser does](recording.md#what-each-browser-does).
