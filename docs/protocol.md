# The protocol

The contract between the widget and the backend that receives its reports: read this to write a receiver.

Version 1. This document is the whole contract between the widget and a receiver; a project
implementing its own receiver needs to read nothing else.

## The request

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

## The report

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
| `url` | string | required | The page's address, [scrubbed](security.md#scrubbing) | 2,000 |
| `title` | string | optional | `document.title` | 200 |
| `referrer` | string | optional | The page before, [scrubbed](security.md#scrubbing) | 2,000 |
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

An entry of `requests`: `url` (string, [scrubbed](security.md#scrubbing), up to 2,000 characters), `status`
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
values, keystrokes, or request or response bodies. Pages other than the one the report was sent
from appear only when a recording went across them (`pages`, and the `page` of an error or request).

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

## The answer

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

## What a receiver must do

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
  its scheme is `http` or `https` and, on your own site, only when it is one of your page routes:
  an address that acts when opened would run as the staff member who clicked it. Anything else
  (`javascript:`, `data:`) is shown as text. [Reading reports safely](security.md#reading-reports-safely)
  has the rules for the page where reports are read.
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

## How the protocol changes

A new optional field, `kind`, `code` or file type is a minor version of the widget and leaves
`schemaVersion` alone; receivers already ignore what they do not know, and the widget treats an
unknown `code` by its status. Removing a field, changing a type or meaning, or making an optional
field required is a new `schemaVersion`. The widget sends one version; a receiver may take several.

## Checking a receiver

`tests/conformance.js` is a command-line check that posts every case of the protocol to a
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

## Example receivers

[`examples/receiver.php`](../examples/receiver.php) and [`examples/receiver.js`](../examples/receiver.js)
are minimal receivers in PHP and in Node, about a hundred lines each, with no dependencies. They
read the `report` field and up to two files, check them and write them to a directory.
[`examples/README.md`](../examples/README.md) says how to run them and what they leave out before
either faces the internet.
