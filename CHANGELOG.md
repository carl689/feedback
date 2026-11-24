# Changelog

The widget follows semantic versioning. A major version changes the stub and the panel together:
a panel of another major version refuses to open. The protocol has its own number,
`schemaVersion`, which a minor version of the widget never changes (README.md, How the protocol
changes).

## 1.2.0

A browser that can capture but cannot promise this tab captures what its own picker offers.
Protocol `schemaVersion` 1, with an optional field added.

- Where `getSupportedConstraints()` lists no `displaySurface` (Firefox today), the Screenshot and
  Record buttons are shown with a note, `anySurfaceNote`, and the widget takes the window or screen
  the person picks; before, those browsers had no buttons. Where the browser can capture this tab
  (Chrome and Edge) nothing changes. The capability is asked at every press, so a browser that
  starts reporting a tab surface gets the strict rule with no release.
- `anySurface` (default `true`): `false` keeps the strict rule everywhere, as before.
- The report: `attachments.screenshot.surface` and `attachments.video.surface` say what the browser
  reported was captured (`browser`, `window`, `monitor`), absent when it reported nothing.
- A screenshot over 3,840 pixels on its longer side, or over 4 MB, is scaled down until it fits.
- A Firefox WebM's Duration of 0 is overwritten with the length, so other players can show and seek
  it.
- The tests gain a Firefox project (`firefox.spec.js`, on an Xvfb display of its own) and
  `surface.spec.js`.
- The stub is 4,091 bytes gzipped against a budget of 4,096.

## 1.1.0

A recording follows the person from page to page. Protocol `schemaVersion` 1, with optional
fields added.

- While a recording runs, a navigation that would unload the page is held in a same-origin frame
  over it (the Navigation API), so one recording covers a walk through the site; leaving the site
  ends it and keeps it. After Send or Cancel the person stays on the page they reached, and the
  window goes there for real at their next navigation. `video.follow` (default `true`) switches it
  off; without the Navigation API nothing changes. README.md, Recording across pages.
- The report: `pages` (the pages visited, when more than one), `page` on each error and request of
  such a report, and failed requests kept ahead of the rest past `requestCount`. Receivers that
  ignore unknown fields need no change.
- A framed page's stub hands its buffer to the widget above and opens the one panel there.
- Labels `recordNoteFollows`, `recordingLeft`, `recordingBlocked`, `sentPagesOne`, `sentPagesOther`, `sentFields`.
- When a recording starts, focus goes back to the page instead of to Stop, so typing (a scanner's
  keys and Enter) carries on there; the pill announces itself and stays reachable by Tab.
- The exit from the frame happens when the next GET navigation commits in the frame, so a download,
  a 204 or Stay at a page's "Leave site?" leaves the person where they were instead of on a blank
  page; the new page is requested twice. An exit refused at "Leave site?" no longer goes to the
  declined address later. While a recording or screenshot is held unsent, the frame keeps following.
  Back to the first page, then a link, leaves for real.
- A redirect to another site after several framed pages leaves no dead Back presses.
- `feedback.reset()`, `close()` and `setContext()` on a framed page reach the panel above.
- A second report no longer carries what the first reported (the covered page's errors and
  requests before it).
- Printing while framed prints the framed page; the covered page's popovers and late modal dialogs
  stay beneath the frame; the pill is the last Tab stop; the frame's layer is no dialog to assistive
  technology and keeps its place against a page's `dialog[open]` rules; at the start of a recording
  focus is never given to a stand-in.
- A WebM recording carries its length, so it can be sought before it has been played.
- Hardened after an independent review:
  - A polluted `Object.prototype` is never a setting, a label, a draft field or part of an answer:
    every such read is of an own property, and every object read by name has no prototype.
  - An endpoint on another origin is taken from `init()` only, never from a `data-` attribute. A
    second copy of the stub with different attributes says once which copy is in charge.
  - No cut splits a surrogate pair, and the report is well-formed Unicode (a lone surrogate is
    sent as U+FFFD).
  - Scrubbing: `scrubParams` adds to the built-in names, which now include `apikey`, `api_key`,
    `access_token`, `sid`, `sessionid`, `jsessionid`, `phpsessid`, `session`, `pwd`, `pass`, `sig`, `jwt`, `otp` and
    `authorization`; nested and relative URLs; `"name": "value"` and `name=value` in any text;
    `Basic` credentials; card numbers beside other digits and with any common separator. Text is
    cut before it is scrubbed. README.md says what scrubbing cannot catch.
  - `reset()` drops whatever was under way (a screenshot being asked for, a send in flight, a
    panel still loading) and later reports leave out requests made before it.
  - The Send button stays focusable while busy (`aria-disabled`); after a refusal focus goes to
    the offer or to Send.
  - Under a CSP without `frame-src 'self'` a recording across pages stops with a true reason
    (`recordingBlocked`). Trusted Types: one policy, `feedback`, for the panel's address and the
    frame's document; a page that does not allow it gets one console error.
  - The hub takes a panel only while loading one; a bad trigger falls back to the default; a
    launcher position that is not text, a stub with no `defer` and an inline stub work; the
    console wrapper never throws and keeps a huge object short; a malformed `panelIntegrity`
    loads no panel; a `MediaRecorder` that throws stops the capture; the preview follows late
    errors and names `fields`; `timeoutMs` covers `beforeSend` and `headers`, and what
    `beforeSend` returns is held to the protocol again; a sane `Retry-After` only; a trigger in
    a shadow root works; `document.title` and `referrer` cannot be clobbered; no capture buttons
    where `displaySurface` is not reported; the launcher's `zIndex` is range-checked.
  - The example receivers have no default directory (503 `disabled` without `FEEDBACK_DIR`),
    store with owner-only permissions, take an id atomically, cut an error's `source`, accept an
    empty file field, and agree on the depth edge; `conformance.js` checks the version code, a
    blank message, a missing id and an uploaded file name that is a path.
- The stub is 4,085 bytes gzipped against a budget of 4,096.

## 1.0.0

The first release. Protocol `schemaVersion` 1.

- `feedback.js`, the stub: the console and error buffer, the trigger, the optional launcher, the
  settings it uses itself, and loading the panel on the first press.
- `feedbackPanel.js`, the panel: the form (type, message, attachments, what is sent), settings
  validation, the draft in `sessionStorage`, screenshot and screen recording of the current tab,
  scrubbing, the multipart request and the answer table.
- Every word in `labels`, every color a custom property, the panel in a shadow root styled by
  adopted stylesheets, with no `unsafe-inline` and no `eval`.
- The stub is 3,469 bytes gzipped against a budget of 4,096; see README.md, Size.
