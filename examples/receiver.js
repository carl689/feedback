// A minimal feedback receiver for protocol schemaVersion 1: one file, no dependencies, Node 18+.
//   FEEDBACK_DIR=/var/lib/feedback PORT=0 node receiver.js   (0 = any free port, printed; without FEEDBACK_DIR it answers 503)
// It is an open receiver, a public upload endpoint. Before it faces the internet add what it leaves
// out: an allowlist of the page origins that may post (check Origin), a rate limit by address, and,
// where there is one, sign-in (then key a stored id by the signed-in sender and take the sender from
// the session, never from the report's `user`). It answers no CORS (README.md says how to allow a
// page on another origin). It stores and never serves: whatever later serves a stored file sends its
// stored type with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dir = process.env.FEEDBACK_DIR || '';   // no place to store chosen: switched off, never a guessed one
const types = ['bug', 'feature', 'message'];   // the widget's `types` setting
const magic = {
    screenshot: { 'image/png': /^\x89PNG\r\n\x1a\n/, 'image/jpeg': /^\xff\xd8\xff/, 'image/webp': /^RIFF[^]{4}WEBP/ },
    video: { 'video/webm': /^\x1a\x45\xdf\xa3[^]{0,40}webm/, 'video/mp4': /^[^]{4}ftyp/ },
};
const maxBytes = { screenshot: 5 << 20, video: 12 << 20, request: 18 << 20 };
const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const required = { id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, widgetVersion: /^[^]{1,20}$/u,
    type: new RegExp(`^(${types.join('|')})$`), message: /\S/, url: /\S/, openedAt: time, sentAt: time };

class Refusal extends Error {
    constructor(status, code, message, field) { super(message); Object.assign(this, { status, code, field }); }
}
const refuse = (status, code, message, field) => { throw new Refusal(status, code, message, field); };
const tooDeep = (value, depth = 0) => depth > 16 || (value !== null && typeof value === 'object' && Object.values(value).some(v => tooDeep(v, depth + 1)));
const cut = (values, caps) => {   // each value named in caps cut to that many characters, a non-string as its JSON
    for (const [key, cap] of Object.entries(caps)) {
        if (key in values) values[key] = [...(typeof values[key] === 'string' ? values[key] : JSON.stringify(values[key]))].slice(0, cap).join('');
    }
    return values;
};

function pixels(bytes, type) {   // [width, height] from the image's own header; null when it cannot be read
    try {
        if (type === 'image/png') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
        const chunk = bytes.toString('latin1', 12, 16);
        if (type === 'image/webp' && chunk === 'VP8X') return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
        if (type === 'image/webp' && chunk === 'VP8L') return [1 + (bytes.readUInt32LE(21) & 0x3fff), 1 + ((bytes.readUInt32LE(21) >> 14) & 0x3fff)];
        if (type === 'image/webp' && chunk === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
        for (let i = 2; type === 'image/jpeg' && bytes[i] === 0xff; i += 2 + bytes.readUInt16BE(i + 2)) {   // walk the segments to the frame header
            if (bytes[i + 1] >= 0xc0 && bytes[i + 1] <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(bytes[i + 1])) return [bytes.readUInt16BE(i + 7), bytes.readUInt16BE(i + 5)];
        }
    } catch { /* a header cut short is unreadable */ }
    return null;
}

async function receive(req) {
    if (!dir) refuse(503, 'disabled', 'Feedback is switched off here.');
    if (req.method !== 'POST') refuse(405, 'invalid', 'Post a report here.');
    let received = 0;   // past the limit the rest is read and dropped, so the sender gets the 413 rather than a reset
    const body = (async function* () { for await (const chunk of req) if ((received += chunk.length) <= maxBytes.request) yield chunk; })();
    const form = await new Request('http://receiver/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] || '' }, body, duplex: 'half' })
        .formData().catch(() => received > maxBytes.request ? refuse(413, 'tooLarge', 'The request is larger than this receiver takes.')
            : refuse(400, 'invalid', 'The request is not multipart/form-data.'));
    const json = form.get('report');
    if (typeof json === 'string' && Buffer.byteLength(json) > 256 << 10) refuse(413, 'tooLarge', 'The report is larger than 256 KB.', 'report');
    let report = null;
    try { report = typeof json === 'string' ? JSON.parse(json) : null; } catch { /* refused below */ }
    if (!report || typeof report !== 'object' || Array.isArray(report) || tooDeep(report)) refuse(400, 'invalid', 'The report is missing, not a JSON object, or nested too deep.', 'report');
    if (report.schemaVersion !== 1) refuse(400, 'unsupportedVersion', 'This receiver takes schemaVersion 1.', 'schemaVersion');
    for (const [key, pattern] of Object.entries(required)) {
        if (typeof report[key] !== 'string' || !pattern.test(report[key])) refuse(400, 'invalid', `The report's ${key} is missing or not valid.`, key);
    }
    if (Buffer.byteLength(JSON.stringify(report.context ?? {})) > 16 << 10) refuse(413, 'tooLarge', 'The report context is larger than 16 KB.', 'context');
    // The protocol's caps, re-applied: the widget's own trimming is not relied on.
    cut(report, { message: 5000, url: 2000, title: 200, referrer: 2000, project: 50, environment: 30, release: 40 });
    for (const [key, cap] of [['errors', 50], ['requests', 30], ['pages', 50]]) {
        if (key in report) report[key] = [].concat(report[key]).slice(-cap).map(entry => cut(Object(entry), { message: 500, stack: 2000, source: 2000, url: 2000, title: 200, page: 2000 }));
    }
    if ('user' in report) report.user = cut(Object(report.user), { id: 200, name: 200 });
    const files = {};
    for (const [part, kinds] of Object.entries(magic)) {
        const file = form.get(part);
        if (!(file instanceof Blob) || !file.size) continue;   // an empty file field is no file
        if (file.size > maxBytes[part]) refuse(413, 'tooLarge', `The ${part} is larger than this receiver takes.`, part);
        const bytes = Buffer.from(await file.arrayBuffer());
        const type = Object.keys(kinds).find(kind => kinds[kind].test(bytes.toString('latin1', 0, 64)));
        const size = part === 'screenshot' && type ? pixels(bytes, type) : [0, 0];
        if (!type || !size) refuse(415, 'unsupportedMedia', `The ${part} is not a type this receiver takes.`, part);
        if (Math.max(...size) > 8192) refuse(413, 'tooLarge', 'The screenshot is over 8,192 pixels on a side.', part);
        files[part] = { bytes, type };
    }

    const id = report.id.toLowerCase();   // checked as a UUID above, so safe as a file name
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(path.join(dir, `${id}.json`), '', { flag: 'wx', mode: 0o600 }); }   // made only if absent, in one step
    catch (e) { if (e.code === 'EEXIST') return [200, { id }]; throw e; }   // a retry: the first one's reference, nothing stored
    const record = { receivedAt: new Date().toISOString(), address: req.socket.remoteAddress, files: {}, report };
    try {
        for (const [part, { bytes, type }] of Object.entries(files)) {
            const name = `${id}.${part}.${type.split('/')[1]}`;
            fs.writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
            record.files[part] = { name, type, bytes: bytes.length };
        }
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(record, null, 2), { mode: 0o600 });
    } catch (e) { fs.rmSync(path.join(dir, `${id}.json`), { force: true }); throw e; }   // give the id back, so a retry can store it
    return [201, { id }];
}

const send = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
http.createServer((req, res) => receive(req).then(([status, body]) => send(res, status, body), error => error instanceof Refusal
    ? send(res, error.status, { error: { code: error.code, message: error.message, field: error.field } })
    : (console.error(error), send(res, 500, { error: { code: 'failed', message: 'The report could not be stored.' } }))))
    .listen(Number(process.env.PORT || 0), '127.0.0.1', function () {
        console.log(`feedback receiver on http://127.0.0.1:${this.address().port}/, storing in ${dir}`);
    });
