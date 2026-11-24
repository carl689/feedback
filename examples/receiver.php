<?php
// A minimal feedback receiver for protocol schemaVersion 1: one file, no dependencies, PHP 8.2+ with mbstring.
//   FEEDBACK_DIR=/var/lib/feedback php -S 127.0.0.1:8000 receiver.php   (without FEEDBACK_DIR it answers 503, switched off)
// It is an open receiver, a public upload endpoint. Before it faces the internet add what it leaves
// out: an allowlist of the page origins that may post (check Origin), a rate limit by address, and,
// where there is one, sign-in (then key a stored id by the signed-in sender and take the sender from
// the session, never from the report's `user`). It answers no CORS (README.md says how to allow a
// page on another origin). It stores and never serves: whatever later serves a stored file sends its
// stored type with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
declare(strict_types=1);
umask(0077);   // what it stores is readable by its own user only

$dir = getenv('FEEDBACK_DIR') ?: '';
$types = ['bug', 'feature', 'message'];   // the widget's `types` setting
$magic = [
    'screenshot' => ['image/png' => '/^\x89PNG\r\n\x1a\n/', 'image/jpeg' => '/^\xff\xd8\xff/', 'image/webp' => '/^RIFF.{4}WEBP/s'],
    'video' => ['video/webm' => '/^\x1a\x45\xdf\xa3.{0,40}webm/s', 'video/mp4' => '/^.{4}ftyp/s'],
];
$maxBytes = ['screenshot' => 5 << 20, 'video' => 12 << 20];

/** Answers and ends the request; a refusal is {"error": {"code", "message", "field"}}. */
function answer(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json');
    exit(json_encode($body));
}

/** Refuses the report with the protocol's status, code, text for the person and the field at fault. */
function refuse(int $status, string $code, string $message, ?string $field = null): never
{
    answer($status, ['error' => array_filter(['code' => $code, 'message' => $message, 'field' => $field])]);
}

/** Cuts each value of $values named in $caps to that many characters, a non-string as its JSON. */
function cut(array $values, array $caps): array
{
    foreach (array_intersect_key($caps, $values) as $key => $cap) {
        $values[$key] = mb_substr(is_string($values[$key]) ? $values[$key] : json_encode($values[$key]), 0, $cap);
    }
    return $values;
}

if ($dir === '') {
    refuse(503, 'disabled', 'Feedback is switched off here.');   // no place to store chosen: never a guessed one
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    refuse(405, 'invalid', 'Post a report here.');
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > (ini_parse_quantity(ini_get('post_max_size')) ?: PHP_INT_MAX)) {
    refuse(413, 'tooLarge', 'The request is larger than this receiver takes.');   // PHP has dropped the whole body
}
$json = $_POST['report'] ?? null;
if (is_string($json) && strlen($json) > 256 << 10) {
    refuse(413, 'tooLarge', 'The report is larger than 256 KB.', 'report');
}
$report = is_string($json) ? json_decode($json, true, 17) : null;   // 16 levels below the report, as receiver.js counts
if (!is_array($report) || array_is_list($report)) {
    refuse(400, 'invalid', 'The report is missing, not a JSON object, or nested too deep.', 'report');
}
if (($report['schemaVersion'] ?? null) !== 1) {
    refuse(400, 'unsupportedVersion', 'This receiver takes schemaVersion 1.', 'schemaVersion');
}
$time = '/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z\z/';
$required = ['id' => '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i', 'widgetVersion' => '/^.{1,20}\z/su',
    'type' => '/^(' . implode('|', $types) . ')\z/', 'message' => '/\S/u', 'url' => '/\S/u', 'openedAt' => $time, 'sentAt' => $time];
foreach ($required as $key => $pattern) {
    if (!is_string($report[$key] ?? null) || !preg_match($pattern, $report[$key])) {
        refuse(400, 'invalid', "The report's $key is missing or not valid.", $key);
    }
}
if (strlen(json_encode($report['context'] ?? [])) > 16 << 10) {
    refuse(413, 'tooLarge', 'The report context is larger than 16 KB.', 'context');
}
// The protocol's caps, re-applied: the widget's own trimming is not relied on.
$report = cut($report, ['message' => 5000, 'url' => 2000, 'title' => 200, 'referrer' => 2000, 'project' => 50, 'environment' => 30, 'release' => 40]);
foreach (['errors' => 50, 'requests' => 30, 'pages' => 50] as $key => $cap) {
    if (isset($report[$key])) {
        $report[$key] = array_map(fn($entry): array => cut((array) $entry, ['message' => 500, 'stack' => 2000, 'source' => 2000, 'url' => 2000, 'title' => 200, 'page' => 2000]), array_slice((array) $report[$key], -$cap));
    }
}
if (isset($report['user'])) {
    $report['user'] = cut((array) $report['user'], ['id' => 200, 'name' => 200]);
}
$files = [];
foreach ($magic as $part => $kinds) {
    $file = $_FILES[$part] ?? null;
    if ($file === null || ($file['error'] ?? null) === UPLOAD_ERR_NO_FILE) {
        continue;
    }
    if (!is_int($file['error'] ?? null) || $file['error'] === UPLOAD_ERR_PARTIAL || !is_string($file['tmp_name'] ?? null) || $file['tmp_name'] === '') {
        refuse(400, 'invalid', "Send one whole $part.", $part);
    }
    if (in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $file['size'] > $maxBytes[$part]) {
        refuse(413, 'tooLarge', "The $part is larger than this receiver takes.", $part);
    }
    $head = (string) file_get_contents($file['tmp_name'], false, null, 0, 64);
    $type = array_key_first(array_filter($kinds, fn(string $pattern): bool => preg_match($pattern, $head) === 1));
    $pixels = $part === 'screenshot' && $type !== null ? getimagesize($file['tmp_name']) : [0, 0];
    if ($type === null || $pixels === false) {
        refuse(415, 'unsupportedMedia', "The $part is not a type this receiver takes.", $part);
    }
    if (max($pixels[0], $pixels[1]) > 8192) {
        refuse(413, 'tooLarge', 'The screenshot is over 8,192 pixels on a side.', $part);
    }
    $files[$part] = [$file['tmp_name'], $type];
}

$id = strtolower($report['id']);   // checked as a UUID above, so safe as a file name
if (!is_dir($dir)) {
    mkdir($dir, 0700, true);
}
$claim = @fopen("$dir/$id.json", 'x');   // made only if absent, in one step, so two retries cannot both store
if ($claim === false) {
    file_exists("$dir/$id.json") || refuse(500, 'failed', 'The report could not be stored.');
    answer(200, ['id' => $id]);   // a retry: the first one's reference, nothing stored
}
$record = ['receivedAt' => gmdate('Y-m-d\TH:i:s\Z'), 'address' => $_SERVER['REMOTE_ADDR'], 'files' => new stdClass(), 'report' => $report];
foreach ($files as $part => [$tmpName, $type]) {
    $name = "$id.$part." . explode('/', $type)[1];
    if (!move_uploaded_file($tmpName, "$dir/$name")) {
        unlink("$dir/$id.json");   // give the id back, so a retry can store it
        refuse(500, 'failed', 'The report could not be stored.');
    }
    $record['files']->$part = ['name' => $name, 'type' => $type, 'bytes' => filesize("$dir/$name")];
}
fwrite($claim, json_encode($record, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) || refuse(500, 'failed', 'The report could not be stored.');
fclose($claim);
answer(201, ['id' => $id]);
