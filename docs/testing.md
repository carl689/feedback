# Running the tests

How to run the widget's Playwright suite in Chrome and Firefox, and what each test file covers.

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
picker). No virtual display
is needed; `FEEDBACK_HEADED=1` runs headed (under `xvfb-run` on a machine without a display) if
you want to watch. The refusal of a stream that is not this tab is tested with a stand-in
`getDisplayMedia` that returns a canvas stream reporting `monitor`, `window` or no
`displaySurface`, and a browser that cannot promise a tab with a stand-in
`getSupportedConstraints()` that lists no `displaySurface` (`surface.spec.js`).

The `firefox` project runs `firefox.spec.js` in Playwright's Firefox, beside the Chrome project
(`--project=chrome` or `--project=firefox` runs one). It needs that Firefox and Xvfb:

```sh
npx playwright install firefox      # on a Linux release Playwright does not list yet, put
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

## The stub's size

The stub's budget is 4,096 bytes gzipped (`gzip -9`) as committed, unminified, and
`tests/idle.spec.js` holds it there. At 1.2.0 it measures 11,202 bytes raw and 4,091 bytes
gzipped (a minifier would take it lower, which a project may do; the budget is for the readable
file). The same file holds what the stub costs a page nobody presses the button on: two error
listeners, a wrap of `console.error` and `console.warn`, one click listener and one `load`
listener, and no timer, observer, request, storage read, layout read or DOM write (unless
`launcher` is set).

## Checking a receiver

`tests/conformance.js` checks any receiver against the protocol from the command line; see
[Checking a receiver](protocol.md#checking-a-receiver).

## The pictures in the documentation

`node readmeImages.js`, run in `tests/` after `npm install`, retakes the images in `docs/images/`
from the real widget on [`examples/demo.html`](../examples/demo.html), in the installed Google
Chrome.
