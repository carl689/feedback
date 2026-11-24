# Privacy and security

What the widget collects and scrubs, what it needs from a Content Security Policy, and what it cannot protect against: the document to read before putting it on a page that handles sensitive data.

## What is collected

The report carries what the [report table](protocol.md#the-report) lists and nothing else: never cookies,
storage, the page's HTML, form values, keystrokes, or request or response bodies. Other pages
appear only in a [recording across pages](recording.md#recording-across-pages), and then only the ones the
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

## Scrubbing

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

## The draft

While the panel is open the typed message, the picked type and the report's `id` are kept in
`sessionStorage` (key `feedback.draft`), so a reload, or a sign-in after a 401, does not lose
them. The panel reads it when it opens; the stub never does. It is stored with the `user.id` it
was typed under and thrown away when the panel opens under another. A successful send and
`feedback.reset()` remove it. Attachments are never written to storage.

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
| `frame-src` (or `child-src`) | `'self'`, for a [recording across pages](recording.md#recording-across-pages) only; without it the recording stops at the next page and the panel says the site does not let that page be shown in a frame (`recordingBlocked`) |
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

## A page whose markup can be injected

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

## What the host does

- A page that shows or handles secrets sets `scrubParams` and `scrubPatterns` for them, removes
  what it must in `beforeSend`, or switches the block off with `collect`; a page that shows them
  on screen sets `screenshot: false, video: false`. See [Settings](settings.md#settings).
- Allow scripts by nonce or hash in the page's Content-Security-Policy, and name only the
  receiver's origin in `connect-src`.
- Serve both files from the page's own origin, or set `panelIntegrity` when the panel comes from
  another one. See [Loading the panel](settings.md#loading-the-panel).
- Call `feedback.reset()` when a person signs out. See [On sign-out](settings.md#on-sign-out).
- The receiver decides who sent a report and what to keep. See
  [What a receiver must do](protocol.md#what-a-receiver-must-do).
