# Example receivers

Two minimal receivers for the [feedback protocol](../docs/protocol.md), schemaVersion 1: `receiver.php` and `receiver.js`.
Each is one file with no dependencies that reads the `report` form field and up to two uploaded
files, checks them, and writes them to a directory. They are starting points to copy, not a
service to deploy as they are: read "What they leave out" before either faces the internet.

## Running them

Both store under `$FEEDBACK_DIR`, created with mode 0700, each file readable by its owner only.
There is no default: without `FEEDBACK_DIR` every request is answered 503 `disabled`, so a copy
started by mistake never fills a guessed directory. Point it at a directory outside any web root.

```sh
# PHP 8.2+ with mbstring; the built-in server routes every request to the file
FEEDBACK_DIR=/var/lib/feedback php -S 127.0.0.1:8000 receiver.php

# Node 18+; PORT=0 (the default) takes any free port and prints it
FEEDBACK_DIR=/var/lib/feedback PORT=8000 node receiver.js
```

PHP's own upload limits apply before the script runs: with the stock `upload_max_filesize = 2M`
and `post_max_size = 8M` a larger recording is refused with 413. Raise them to take more, for
example `php -d upload_max_filesize=16M -d post_max_size=17M -S …`. The script's own limits are
5 MB for a screenshot and 12 MB for a recording; the Node receiver also stops reading a request
at 18 MB.

To see the widget posting to the Node receiver, `demo.js` serves a made-up page (`demo.html`) with
the widget on it and passes its reports to `receiver.js`, started beside it:

```sh
FEEDBACK_DIR=/tmp/feedback-reports node demo.js     # then open http://127.0.0.1:8000/
```

Check either receiver with the conformance tool:

```sh
node ../tests/conformance.js http://127.0.0.1:8000/
```

## What they do

- Refuse anything but a `POST`, a request over the size limit (413), a `report` over 256 KB (413),
  a `report` that is not a JSON object or is nested more than 16 deep (400), a `schemaVersion`
  other than 1 (400 `unsupportedVersion`), and a missing or malformed required field (400
  `invalid` with `field`): `id` must be a UUID, `type` one of `bug`, `feature`, `message` (edit
  the list to match the widget's `types`), `message` and `url` not blank, `openedAt` and `sentAt`
  ISO 8601 UTC times.
- Re-apply the protocol's caps: the top-level strings to their lengths, `errors` to the last 50
  entries, `requests` to the last 30 and `pages` to the last 50, with each entry's `message`,
  `stack`, `source`, `url`, `title` and `page` cut,
  `user.id` and `user.name` to 200, and refuse a `context` over 16 KB.
- Read each file's type from its first bytes (PNG, JPEG and WebP for `screenshot`, WebM and MP4
  for `video`; never SVG, never the part's header or `attachments`), refuse anything else with
  415 `unsupportedMedia`, and refuse a screenshot over 8,192 pixels on a side, read from the
  image's own header, with 413 `tooLarge`.
- Store a given `id` once: a second report with the same `id` answers 200 with the same `id` and
  writes nothing. The id's file is created only if it does not exist, in one step (`fopen(…, 'x')`,
  `flag: 'wx'`), so two copies arriving at the same instant cannot both store; if storing then
  fails, the name is given back so a retry can store it. The report is `<id>.json` and its files `<id>.screenshot.<ext>` and
  `<id>.video.<ext>`: names the receiver makes from the checked UUID and the type it read, never
  the uploaded file name.
- Stamp their own facts beside the report: `receivedAt` from the server's clock and `address`, the
  connecting address. Everything inside `report` stays the page's claim.
- Refuse with `{"error": {"code", "message", "field"}}` and the status from the protocol's table;
  accept with 201 and `{"id": "<id>"}`.
- Ignore unknown report fields and unknown parts, and take a file field sent with no file (an
  empty `<input type="file">`) as no file.
- Count depth the same way: a value 16 levels below the report is taken, one 17 levels below is
  refused.
- Store the report as it came, with one difference in PHP: it decodes into arrays, so an empty
  object inside the report (`"context": {}`) is stored as `[]`.

## What they leave out

On purpose, so the protocol's shape is easy to see; each is something a real receiver adds:

- **An origin allowlist.** Both accept a post from any page. A receiver checks `Origin` against the
  pages it serves and refuses any other with 403 `unauthorized`; one that trusts a cookie session
  must, or another site can post as a signed-in person.
- **A rate limit by address.** With no sign-in the address is the only handle, and a script can
  send any `Origin`. Answer 429 `rateLimited`, with `Retry-After` when there is a time.
- **Sign-in.** With it, the sender comes from the session or token, never from the report's `user`,
  and a stored `id` is keyed by sender and id, so one person's id can neither block nor reveal
  another's. Without it, as here, every sender is one sender.
- **Serving the files.** Neither serves anything back. Whatever does serves a file only to those
  who may read reports, with its stored type, `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`, and shows every string as text: a URL
  from a report becomes a link only when its scheme is `http` or `https`.
- **CORS**, below.
- **A database.** A directory of files is the store; a real receiver keeps reports where it can
  query them, with a unique key on the sender and `id`.
- **Telling anyone**: an email, a chat post or an issue in a tracker is the next line to add.

## A page on another origin

The widget's request is a simple request (a `POST` of `multipart/form-data` with no custom
headers), so a browser sends it cross-origin with no preflight, but the page can read the answer,
and so show the person a refusal's message or the receiver's `id`, only when the receiver allows
that page's origin. Allow the page's own origins by name, never `*`, and never `*` with
credentials. In PHP, at the top of the file:

```php
$allowed = ['https://shop.example.com'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Vary: Origin');
if (in_array($origin, $allowed, true)) {
    header("Access-Control-Allow-Origin: $origin");
} elseif ($origin !== '') {
    refuse(403, 'unauthorized', 'Reports are not taken from this page.');
}
```

In Node, the same before `receive(req)` runs, with `res.setHeader()`. Add
`Access-Control-Allow-Credentials: true` only when the widget is set to `credentials: 'include'`
and the receiver reads a cookie. A widget given `headers` makes the browser send an `OPTIONS`
preflight first; answer it with 204, the same `Access-Control-Allow-Origin`,
`Access-Control-Allow-Methods: POST` and `Access-Control-Allow-Headers` naming those headers
(both examples answer `OPTIONS` with 405 as they stand).
