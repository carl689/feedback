#!/usr/bin/env node
// Posts every case of the feedback protocol (schemaVersion 1) to a receiver and says whether it
// answers correctly. Plain Node 18+, no dependencies, nothing to install.
//
//   node conformance.js <url> [--field name=value]... [--header 'Name: value']... [--origin <origin>]
//                             [--type <type>] [--only <case>[,<case>]]... [--keep] [--json] [--list]
//
// --field   a form field the receiver's dispatcher needs, sent in every request (the widget's `fields`)
// --header  a header sent in every request: a Cookie or an Authorization for a signed-in receiver
// --origin  the page's origin, sent as Origin (and Referer, Sec-Fetch-Site) as a browser would; also
//           runs forged-origin, one report from another origin, which must be refused
// --type    the report type the valid cases use (default bug), for a receiver with its own `types`
// --only    run only the named cases; --list names them
// --keep    send the messages unmarked; by default each starts with [conformance] so the reports can
//           be found and deleted on the receiving side
// --json    one JSON document on stdout instead of the terminal report
// Exits 0 when no case failed, 1 when one did, 2 on a usage error.
'use strict';
const zlib = require('node:zlib');
const { randomUUID } = require('node:crypto');

const TIMEOUT_MS = 15000;
const MARKER = '[conformance]';
const FORGED_ORIGIN = 'https://forged-origin.invalid';
// The answer table: each refusal code and the statuses it may arrive with.
const CODES = {
    invalid: [400, 422], unsupportedVersion: [400], unauthorized: [401, 403], tooLarge: [413],
    unsupportedMedia: [415], rateLimited: [429], disabled: [503],
};

// ---------------------------------------------------------------------------------------------
// The answer, classified by the protocol's rules and nothing else.

/**
 * Classifies one HTTP answer as accepted, refused or broken.
 * Accepted: a 2xx whose body is empty or JSON and carries no `error`. Refused: a 4xx or 5xx, or a
 * 2xx whose JSON has an `error` (the dispatcher allowance), with the text from error.message, else
 * error.msg, else a top-level message, and a numeric error.code read as the status the dispatcher
 * did not set. Broken: a redirect (the widget never follows one) or a 2xx body that is not JSON.
 */
function classify(httpStatus, bodyText, location) {
    const excerpt = bodyText.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (httpStatus >= 300 && httpStatus < 400) {
        return { kind: 'broken', httpStatus, excerpt, reason: `a redirect (${httpStatus} to ${location || 'no Location'}), which the widget refuses to follow` };
    }
    if (httpStatus < 200 || httpStatus > 599) {
        return { kind: 'broken', httpStatus, excerpt, reason: `HTTP ${httpStatus}, not an answer the protocol knows` };
    }
    let body;
    let isJson = false;
    if (bodyText.trim() !== '') {
        try { body = JSON.parse(bodyText); isJson = true; } catch { /* not JSON */ }
    }
    const object = isJson && body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
    // An `error` of null or false is a dispatcher's way of saying there is none.
    const error = object.error !== undefined && object.error !== null && object.error !== false ? object.error : undefined;
    const is2xx = httpStatus >= 200 && httpStatus < 300;
    if (is2xx && error === undefined) {
        if (bodyText.trim() !== '' && !isJson) {
            return { kind: 'broken', httpStatus, excerpt, reason: `${httpStatus} with a body that is neither empty nor JSON` };
        }
        const id = typeof object.id === 'string' || typeof object.id === 'number' ? String(object.id) : undefined;
        return { kind: 'accepted', httpStatus, status: httpStatus, id, message: typeof object.message === 'string' ? object.message : undefined, excerpt };
    }
    const details = error !== null && typeof error === 'object' ? error : {};
    // A bare string `error` is read last, after the protocol's three places.
    const message = [details.message, details.msg, object.message, error].find(text => typeof text === 'string');
    const numeric = typeof details.code === 'number' ? details.code : undefined;
    return {
        kind: 'refused',
        httpStatus,
        status: is2xx ? numeric : httpStatus,
        code: typeof details.code === 'string' ? details.code : undefined,
        message,
        field: typeof details.field === 'string' ? details.field : undefined,
        envelope: is2xx,
        excerpt,
    };
}

/** True when a refusal is one of the given codes: by its status, and with no known code that says otherwise. */
function refusedAs(answer, codes) {
    if (answer.kind !== 'refused') return false;
    if (answer.code !== undefined && CODES[answer.code] && !codes.includes(answer.code)) return false;
    if (answer.status !== undefined) return codes.some(code => CODES[code].includes(answer.status));
    return answer.code !== undefined && codes.includes(answer.code);
}

/** One line saying what came back. */
function describe(answer) {
    if (answer.kind === 'none') return `no answer: ${answer.reason}`;
    if (answer.kind === 'broken') return `${answer.reason}${answer.excerpt ? `: ${answer.excerpt}` : ''}`;
    if (answer.kind === 'accepted') return `accepted (${answer.httpStatus}${answer.id !== undefined ? `, id ${answer.id}` : ''})`;
    const status = answer.envelope ? `${answer.httpStatus} with an error body${answer.status ? `, read as ${answer.status}` : ''}` : `${answer.httpStatus}`;
    const parts = [answer.code, answer.field && `field ${answer.field}`].filter(Boolean).join(', ');
    const text = answer.message !== undefined ? `"${answer.message.slice(0, 100)}"` : answer.excerpt ? `body: ${answer.excerpt}` : 'no body';
    return `refused ${status}${parts ? ` (${parts})` : ''}: ${text}`;
}

/** A pointer for the commonest wrong setups. */
function hint(answer) {
    const status = answer.status ?? (answer.code && CODES[answer.code] ? CODES[answer.code][0] : undefined);
    if (answer.kind !== 'refused') return '';
    if (status === 401 || status === 403) return ' (a session or token missing? pass --header and --origin)';
    if (status === 404 || status === 405) return ' (is this the endpoint? does its dispatcher need a --field?)';
    if (status === 429) return ' (rate limited: wait, or raise the limit for the run)';
    if (status === 503) return ' (the receiver says it is switched off)';
    return '';
}

const codesText = codes => codes.map(code => `${CODES[code].join('/')} ${code}`).join(' or ');

// ---------------------------------------------------------------------------------------------
// Honest files: the receiver reads the type from the bytes.

const CRC_TABLE = Array.from({ length: 256 }, (unused, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
});

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** A valid 8-bit grayscale PNG of the given size, a gradient. */
function png(width, height) {
    const chunk = (type, data) => {
        const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
        const length = Buffer.alloc(4);
        const crc = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        crc.writeUInt32BE(crc32(typed));
        return Buffer.concat([length, typed, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;   // bit depth; color type 0 (grayscale), compression, filter and interlace all 0
    const row = Buffer.alloc(1 + width);   // filter byte 0, then the pixels
    for (let x = 0; x < width; x++) row[1 + x] = (x * 255 / Math.max(1, width - 1)) | 0;
    const pixels = zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))]);
}

/** The start of a real WebM: the EBML header with doctype webm, a Segment and its Info; padded to totalBytes with an EBML Void. */
function webm(totalBytes = 0) {
    const app = [...Buffer.from('conformance')];
    const head = Buffer.from([
        0x1a, 0x45, 0xdf, 0xa3, 0x9f,               // EBML, 31 bytes
        0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08,
        0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,   // DocType "webm"
        0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02,
        0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,   // Segment, size unknown
        0x15, 0x49, 0xa9, 0x66, 0xa3,               // Info, 35 bytes
        0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40,   // TimestampScale 1,000,000
        0x4d, 0x80, 0x8b, ...app, 0x57, 0x41, 0x8b, ...app,   // MuxingApp, WritingApp
    ]);
    if (totalBytes <= head.length + 9) return head;
    const padding = totalBytes - head.length - 9;
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(padding) | (1n << 56n));   // an 8-byte EBML size: marker 0x01, then 7 bytes
    return Buffer.concat([head, Buffer.from([0xec]), size, Buffer.alloc(padding)]);
}

const TEXT_FILE = Buffer.from('This is a text file, not a video.\n');
const HTML_FILE = Buffer.from('<!doctype html><html><body><script>alert(document.domain)</script></body></html>\n');
const SVG_FILE = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40">'
    + '<script>alert(document.domain)</script><rect width="64" height="40"/></svg>\n');

// ---------------------------------------------------------------------------------------------
// The cases. Each run() answers {outcome: pass|fail|warn|check|skip, detail, check?}; every case is
// required, and a warning or a hand check never fails the run.

const pass = detail => ({ outcome: 'pass', detail });
const fail = detail => ({ outcome: 'fail', detail });
const warn = detail => ({ outcome: 'warn', detail });
const check = (detail, todo) => ({ outcome: 'check', detail, check: todo });

const expectAccepted = answer => (answer.kind === 'accepted' ? pass(describe(answer)) : fail(`expected acceptance, got ${describe(answer)}${hint(answer)}`));
const expectRefused = (answer, codes) => (refusedAs(answer, codes) ? pass(describe(answer)) : fail(`expected ${codesText(codes)}, got ${describe(answer)}${hint(answer)}`));

/**
 * A file of the wrong kind in a part. The table answers 415 unsupportedMedia; 400/422 invalid is
 * passed with a note. A 2xx is a failure when the full case showed this receiver takes the part,
 * since the file was then either stored or dropped without telling the sender; otherwise it can
 * only be checked by hand.
 */
function wrongFile(run, answer, part, what) {
    if (refusedAs(answer, ['unsupportedMedia'])) return pass(describe(answer));
    if (refusedAs(answer, ['invalid'])) {
        return pass(`${describe(answer)}; note: the table's answer is 415 unsupportedMedia, which makes the widget offer to send without the file`);
    }
    if (refusedAs(answer, ['tooLarge']) && run.takes[part] === false) return pass(`${describe(answer)}; this receiver takes no ${part}`);
    if (answer.kind === 'accepted' && run.takes[part] === true) {
        return fail(`${describe(answer)}: this receiver takes a ${part} (the full case was accepted), so ${what} must be refused with 415; a 2xx means it was stored, or dropped without telling the sender`);
    }
    if (answer.kind === 'accepted') {
        return check(`${describe(answer)}; check by hand that the file was not stored`, `${what} was accepted (report ${answer.id ?? run.lastId}): the stored report has no ${part}, or the ${part} stored is not this file.`);
    }
    return fail(`expected ${codesText(['unsupportedMedia'])}, got ${describe(answer)}${hint(answer)}`);
}

/** A report the receiver may accept (and cut to its caps) or refuse as too large or invalid; never a 5xx or a hang. */
function cappedOrRefused(answer, todo) {
    if (refusedAs(answer, ['tooLarge', 'invalid'])) return pass(describe(answer));
    if (answer.kind === 'accepted') return check(`${describe(answer)}; check the cut by hand`, todo(answer));
    return fail(`expected acceptance or ${codesText(['tooLarge', 'invalid'])}, got ${describe(answer)}${hint(answer)}`);
}

const CASES = [
    {
        name: 'minimal', what: 'the eight required fields and nothing else',
        run: async run => expectAccepted(await run.post({ report: run.report() })),
    },
    {
        name: 'full', what: 'every field, a PNG screenshot and a WebM recording',
        run: async run => {
            const answer = await run.post({ report: run.fullReport(), files: [run.screenshotPart(), run.videoPart()] });
            if (answer.kind === 'accepted') {
                run.takes.screenshot = run.takes.video = true;
                return check(describe(answer), `The full report (${answer.id ?? run.lastId}): its sender is the receiver's own (the session, or the address for an open receiver) and its arrival time the receiver's clock; the user it claims ("Claimed By The Page") is shown as the page's claim, if at all; its screenshot is a 64x40 gradient and its recording ${run.video.length} bytes; its two pages (/conformance/first, /conformance/second) and the page of its error and its request are kept or shown, or ignored without refusing the report.`);
            }
            if (refusedAs(answer, ['tooLarge', 'unsupportedMedia'])) {
                // The part named is not taken; with none named the widget's offer drops the recording.
                if (answer.field === 'screenshot') run.takes.screenshot = false;
                else run.takes.video = false;
                if (answer.field === 'video') run.takes.screenshot = true;
                return warn(`${describe(answer)}: allowed for a receiver that takes ${answer.field ? `no ${answer.field}` : 'no files'}; switch the widget's capture off to match`);
            }
            return fail(`expected acceptance, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'same-id', what: 'one report sent twice, as a retry after a lost answer',
        run: async run => {
            const report = run.report();
            const first = await run.post({ report });
            const second = await run.post({ report });
            if (first.kind !== 'accepted' || second.kind !== 'accepted') {
                return fail(`expected both accepted, got ${describe(first)}, then ${describe(second)}${hint(second.kind === 'accepted' ? first : second)}`);
            }
            const todo = `Report id ${report.id} is stored once, not twice.`;
            if (first.id !== undefined && second.id !== undefined && first.id !== second.id) {
                return fail(`the retry answered id ${second.id}, the first ${first.id}: it was stored twice`);
            }
            if (first.id !== undefined && second.id === undefined) {
                return { ...warn(`the first answer carried id ${first.id}, the retry none; the protocol answers a retry with the first one's id`), check: todo };
            }
            return check(`both accepted${first.id !== undefined ? `, both id ${first.id}` : ', no id given'}`, todo);
        },
    },
    {
        name: 'unknown-field', what: 'a report field the receiver does not know',
        run: async run => expectAccepted(await run.post({ report: run.report({ conformanceFutureField: { added: 'in a later minor version' } }) })),
    },
    {
        name: 'unknown-part', what: 'a text part and a file part the receiver does not know',
        run: async run => expectAccepted(await run.post({
            report: run.report(),
            extra: [{ name: 'conformanceFuturePart', value: 'ignored' }, { name: 'conformanceFutureFile', bytes: Buffer.from('ignored\n'), type: 'text/plain', filename: 'notes.txt' }],
        })),
    },
    {
        name: 'schema-version', what: 'schemaVersion 99',
        run: async run => {
            const answer = await run.post({ report: run.report({ schemaVersion: 99 }) });
            if (!refusedAs(answer, ['unsupportedVersion'])) return expectRefused(answer, ['unsupportedVersion']);
            if (answer.code === 'unsupportedVersion') return pass(describe(answer));
            // a code the widget cannot read as this one tells it the wrong thing
            if (answer.code !== undefined) return fail(`expected the code unsupportedVersion, got ${describe(answer)}`);
            return warn(`${describe(answer)}: a 400 with no code reads as invalid, so the widget cannot say the version is the problem; answer {"error": {"code": "unsupportedVersion"}}`);
        },
    },
    {
        name: 'missing-field', what: 'a report without its required url',
        run: async run => expectRefused(await run.post({ report: run.report({ url: undefined }) }), ['invalid']),
    },
    {
        name: 'missing-id', what: 'a report without its required id',
        run: async run => expectRefused(await run.post({ report: run.report({ id: undefined }) }), ['invalid']),
    },
    {
        name: 'empty-message', what: 'an empty message',
        run: async run => expectRefused(await run.post({ report: run.report({ message: '' }) }), ['invalid']),
    },
    {
        name: 'blank-message', what: 'a message of spaces, a tab and a newline only',
        run: async run => expectRefused(await run.post({ report: run.report({ message: ' \t\n  ' }) }), ['invalid']),
    },
    {
        name: 'unknown-type', what: 'a type that is not one of the types',
        run: async run => expectRefused(await run.post({ report: run.report({ type: 'conformance-unknown-type' }) }), ['invalid']),
    },
    {
        name: 'report-not-json', what: 'a report field that is not JSON',
        run: async run => expectRefused(await run.post({ reportText: '{"schemaVersion": 1, "id": ' }), ['invalid']),
    },
    {
        name: 'id-not-uuid', what: 'an id that is not a UUID (a path, as it happens)',
        run: async run => expectRefused(await run.post({ report: run.report({ id: `../${randomUUID().slice(3)}` }) }), ['invalid']),
    },
    {
        name: 'text-as-video', what: 'a text file sent as video.webm, typed video/webm',
        run: async run => wrongFile(run, await run.post({
            report: run.report({ attachments: { video: { type: 'video/webm', bytes: TEXT_FILE.length, size: [1280, 720], ms: 3000, frameRate: 5 } } }),
            files: [{ name: 'video', bytes: TEXT_FILE, type: 'video/webm', filename: 'video.webm' }],
        }), 'video', 'a text file named video.webm'),
    },
    {
        name: 'html-as-screenshot', what: 'an HTML page sent as screenshot.png, typed image/png',
        run: async run => wrongFile(run, await run.post({
            report: run.report({ attachments: { screenshot: { type: 'image/png', bytes: HTML_FILE.length, size: [64, 40] } } }),
            files: [{ name: 'screenshot', bytes: HTML_FILE, type: 'image/png', filename: 'screenshot.png' }],
        }), 'screenshot', 'an HTML file named screenshot.png'),
    },
    {
        name: 'svg-screenshot', what: 'an SVG with a script as the screenshot, typed image/svg+xml',
        run: async run => wrongFile(run, await run.post({
            report: run.report({ attachments: { screenshot: { type: 'image/svg+xml', bytes: SVG_FILE.length, size: [64, 40] } } }),
            files: [{ name: 'screenshot', bytes: SVG_FILE, type: 'image/svg+xml', filename: 'screenshot.svg' }],
        }), 'screenshot', 'an SVG'),
    },
    {
        name: 'path-file-name', what: 'a real PNG screenshot whose uploaded file name is a path out of the directory',
        run: async run => {
            const filename = '../../conformance-path.png';
            const answer = await run.post({ report: run.report({ attachments: { screenshot: { type: 'image/png', bytes: run.screenshot.length, size: [64, 40] } } }),
                files: [{ name: 'screenshot', bytes: run.screenshot, type: 'image/png', filename }] });
            if (answer.kind === 'accepted') {
                return check(describe(answer), `Report ${answer.id ?? run.lastId}: its screenshot is stored under a name the receiver made, and no file named conformance-path.png exists two directories above the store (or anywhere).`);
            }
            if (refusedAs(answer, ['invalid', 'unsupportedMedia'])) return warn(`${describe(answer)}: safe, but the protocol takes the file whatever its name; a receiver never uses the uploaded name`);
            return fail(`expected acceptance, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'huge-image', what: 'a real PNG 9,000 pixels wide, over the 8,192 limit',
        run: async run => {
            const bytes = png(9000, 1);
            const answer = await run.post({
                report: run.report({ attachments: { screenshot: { type: 'image/png', bytes: bytes.length, size: [9000, 1] } } }),
                files: [{ name: 'screenshot', bytes, type: 'image/png', filename: 'screenshot.png' }],
            });
            if (refusedAs(answer, ['tooLarge'])) return pass(describe(answer));
            if (refusedAs(answer, ['unsupportedMedia', 'invalid'])) return pass(`${describe(answer)}; note: 413 tooLarge fits best ("one part is too big")`);
            if (answer.kind === 'accepted' && run.takes.screenshot === true) {
                return fail(`${describe(answer)}: a receiver must refuse an image over 8,192 pixels on a side`);
            }
            if (answer.kind === 'accepted') {
                return check(`${describe(answer)}; check by hand that the file was not stored`, `A 9000x1 PNG was accepted (report ${answer.id ?? run.lastId}): the stored report has no screenshot.`);
            }
            return fail(`expected ${codesText(['tooLarge'])}, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'script-in-message', what: 'a script tag and an HTML event handler in the message',
        run: async run => {
            const report = run.report({ message: run.mark('<script>alert("conformance")</script><img src=x onerror=alert("conformance")> both tags show as text') });
            const answer = await run.post({ report });
            return answer.kind === 'accepted'
                ? check(describe(answer), `Report ${answer.id ?? report.id}: on the reading side the message shows both tags as text, and no alert opens.`)
                : fail(`expected acceptance, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'javascript-url', what: 'a url of javascript:alert(1)',
        run: async run => {
            const report = run.report({ url: 'javascript:alert(1)' });
            const answer = await run.post({ report });
            if (answer.kind === 'accepted') {
                return check(describe(answer), `Report ${answer.id ?? report.id}: its url, javascript:alert(1), shows as text and is not a link.`);
            }
            if (refusedAs(answer, ['invalid'])) {
                return warn(`${describe(answer)}: allowed, but the protocol asks only that such a url is shown as text, never a link`);
            }
            return fail(`expected acceptance, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'errors-5000', what: 'an errors array of 5,000 entries (about 450 KB)',
        run: async run => {
            const at = new Date().toISOString();
            const errors = Array.from({ length: 5000 }, (unused, i) => ({ kind: 'console.error', message: `conformance error ${i + 1} of 5000`, at, count: 1 }));
            return cappedOrRefused(await run.post({ report: run.report({ errors }) }),
                answer => `Report ${answer.id ?? run.lastId}: its errors are cut to the receiver's cap (50 by default), not 5,000.`);
        },
    },
    {
        name: 'long-message', what: 'a message of 100,000 characters',
        run: async run => cappedOrRefused(await run.post({ report: run.report({ message: run.mark('x'.repeat(100000)) }) }),
            answer => `Report ${answer.id ?? run.lastId}: its message is cut to the receiver's cap (5,000 by default).`),
    },
    {
        name: 'deep-context', what: 'a context nested 100,000 arrays deep (200 KB)',
        run: async run => {
            const depth = 100000;
            const report = run.report({ context: '\u0000deep' });
            const reportText = JSON.stringify(report).replace('"\\u0000deep"', '['.repeat(depth) + ']'.repeat(depth));
            return cappedOrRefused(await run.post({ report, reportText }),
                answer => `Report ${answer.id ?? run.lastId}: its context is cut to a bounded depth, or dropped.`);
        },
    },
    {
        name: 'huge-video', what: 'a 20 MB recording, over the widget default of 10 MB',
        run: async run => {
            const bytes = webm(20 << 20);
            const answer = await run.post({
                report: run.report({ attachments: { video: { type: 'video/webm', bytes: bytes.length, size: [1280, 720], ms: 60000, frameRate: 5 } } }),
                files: [{ name: 'video', bytes, type: 'video/webm', filename: 'video.webm' }],
            });
            if (refusedAs(answer, ['tooLarge', 'unsupportedMedia'])) return pass(describe(answer));
            if (answer.kind === 'accepted') {
                return check(`${describe(answer)}; the receiver's own limit is over 20 MB`, `Report ${answer.id ?? run.lastId} carries a 20 MB recording: is a limit that high meant?`);
            }
            return fail(`expected acceptance or ${codesText(['tooLarge'])}, got ${describe(answer)}${hint(answer)}`);
        },
    },
    {
        name: 'forged-origin', what: `a report from another site (Origin ${FORGED_ORIGIN}); only with --origin`,
        run: async run => {
            if (!run.options.origin) return { outcome: 'skip', detail: 'run with --origin <page origin> to check a receiver that trusts a cookie session' };
            const report = run.report();
            const answer = await run.post({ report, forged: true });
            if (answer.allowOrigin === FORGED_ORIGIN) return fail(`${describe(answer)}, and it allows the forged origin in Access-Control-Allow-Origin`);
            if (refusedAs(answer, ['unauthorized'])) return pass(describe(answer));
            if (answer.kind === 'accepted') return { ...fail(`${describe(answer)}: a report posted from another site was stored`), check: `Delete report ${answer.id ?? report.id}, stored from a forged origin.` };
            return fail(`expected ${codesText(['unauthorized'])}, got ${describe(answer)}`);
        },
    },
    {
        name: 'cors', what: 'no answer allows every origin with credentials (read from the answers above)',
        run: async run => {
            if (run.answers.length === 0) return { outcome: 'skip', detail: 'no answers to read' };
            const withCredentials = run.answers.find(a => a.allowOrigin === '*' && a.allowCredentials === 'true');
            if (withCredentials) return fail('Access-Control-Allow-Origin: * with Access-Control-Allow-Credentials: true');
            if (run.answers.some(a => a.allowOrigin === '*')) return warn('Access-Control-Allow-Origin: *; a receiver answers CORS for its own allowlist of origins');
            const allowed = [...new Set(run.answers.map(a => a.allowOrigin).filter(Boolean))];
            return pass(allowed.length ? `allows only ${allowed.join(', ')}` : 'no CORS headers (same-origin only)');
        },
    },
];

// ---------------------------------------------------------------------------------------------
// One run against one receiver.

class Run {
    constructor(options) {
        this.options = options;
        this.pageOrigin = options.origin || 'https://app.example';
        this.takes = { screenshot: undefined, video: undefined };   // learned from the full case
        this.answers = [];
        this.lastId = undefined;
        this.screenshot = png(64, 40);
        this.video = webm();
    }

    mark(text) {
        return this.options.keep ? text : `${MARKER} ${text}`;
    }

    /** The eight required fields, with a fresh id, plus or minus the given ones (undefined removes). */
    report(changes = {}) {
        const now = Date.now();
        return {
            schemaVersion: 1,
            id: randomUUID(),
            widgetVersion: '1.0.0',
            type: this.options.type,
            message: this.mark(`Sent by the conformance check (${this.caseName}).`),
            url: `${this.pageOrigin}/conformance/${this.caseName}`,
            openedAt: new Date(now - 60000).toISOString(),
            sentAt: new Date(now).toISOString(),
            ...changes,
        };
    }

    fullReport() {
        const at = new Date(Date.now() - 30000).toISOString();
        return this.report({
            title: 'Conformance check',
            referrer: `${this.pageOrigin}/conformance/before`,
            project: 'conformance',
            environment: 'test',
            release: 'conformance-1',
            user: { id: 'claimed-by-the-page', name: 'Claimed By The Page' },
            context: { check: 'conformance', nested: { values: [1, 2, 3] } },
            client: {
                userAgent: `feedback-conformance (Node ${process.version})`, language: 'en-US', timeZone: 'UTC',
                viewport: [1280, 720], screen: [1920, 1080], pixelRatio: 1, online: true, touch: false,
            },
            errors: [{
                kind: 'exception', message: 'TypeError: conformance', source: `${this.pageOrigin}/app.js`, line: 12, column: 3,
                stack: 'TypeError: conformance\n    at save (app.js:12:3)', at, count: 1, page: `${this.pageOrigin}/conformance/second`,
            }],
            requests: [{ url: `${this.pageOrigin}/api/save`, status: 500, ms: 120, at, page: `${this.pageOrigin}/conformance/second` }],
            // a recording that followed the person across two pages
            pages: [
                { url: `${this.pageOrigin}/conformance/first`, title: 'First page', at },
                { url: `${this.pageOrigin}/conformance/second`, title: 'Second page', at },
            ],
            attachments: {
                screenshot: { type: 'image/png', bytes: this.screenshot.length, size: [64, 40], surface: 'browser' },
                video: { type: 'video/webm', bytes: this.video.length, size: [1280, 720], ms: 3000, frameRate: 5, surface: 'monitor' },
            },
        });
    }

    screenshotPart() {
        return { name: 'screenshot', bytes: this.screenshot, type: 'image/png', filename: 'screenshot.png' };
    }

    videoPart() {
        return { name: 'video', bytes: this.video, type: 'video/webm', filename: 'video.webm' };
    }

    /** Posts one request as the widget would (reportText, when given, is sent in place of the report) and answers its classification; never throws. */
    async post({ report, reportText, files = [], extra = [], forged = false }) {
        const form = new FormData();
        for (const [name, value] of this.options.fields) form.append(name, value);
        form.append('report', reportText ?? JSON.stringify(report));
        for (const part of [...files, ...extra]) {
            if (part.bytes) form.append(part.name, new Blob([part.bytes], { type: part.type }), part.filename);
            else form.append(part.name, part.value);
        }
        const headers = new Headers();
        const origin = forged ? FORGED_ORIGIN : this.options.origin;
        if (origin) {
            headers.set('Origin', origin);
            headers.set('Referer', `${origin}/conformance`);
            headers.set('Sec-Fetch-Site', origin === new URL(this.options.url).origin ? 'same-origin' : 'cross-site');
        }
        for (const [name, value] of this.options.headers) {
            if (!(forged && /^(origin|referer|sec-fetch-site)$/i.test(name))) headers.set(name, value);
        }
        this.lastId = report?.id;
        let answer;
        try {
            const response = await fetch(this.options.url, { method: 'POST', body: form, headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
            answer = classify(response.status, await response.text(), response.headers.get('location'));
            answer.allowOrigin = response.headers.get('access-control-allow-origin') ?? undefined;
            answer.allowCredentials = response.headers.get('access-control-allow-credentials') ?? undefined;
            this.answers.push(answer);
        } catch (error) {
            const reason = error.name === 'TimeoutError' || error.name === 'AbortError'
                ? `nothing within ${TIMEOUT_MS / 1000} s`
                : `${error.message}${error.cause ? ` (${error.cause.code || error.cause.message})` : ''}`;
            answer = { kind: 'none', reason };
        }
        return answer;
    }
}

// ---------------------------------------------------------------------------------------------
// The command line.

function usage(message) {
    if (message) process.stderr.write(`conformance: ${message}\n`);
    process.stderr.write('usage: node conformance.js <url> [--field name=value]... [--header "Name: value"]... [--origin <origin>]\n'
        + '                           [--type <type>] [--only <case>[,<case>]]... [--keep] [--json] [--list]\n');
    process.exit(message ? 2 : 0);
}

function parseOptions(argv) {
    const options = { url: null, fields: [], headers: [], origin: null, type: 'bug', only: [], keep: false, json: false, list: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => (i + 1 < argv.length ? argv[++i] : usage(`${arg} needs a value`));
        if (arg === '--field') {
            const field = value();
            const at = field.indexOf('=');
            if (at < 1) usage(`--field takes name=value, not ${field}`);
            const name = field.slice(0, at);
            if (['report', 'screenshot', 'video'].includes(name)) usage(`--field ${name} would replace the protocol's own part`);
            options.fields.push([name, field.slice(at + 1)]);
        } else if (arg === '--header') {
            const header = value();
            const at = header.indexOf(':');
            if (at < 1) usage(`--header takes 'Name: value', not ${header}`);
            options.headers.push([header.slice(0, at).trim(), header.slice(at + 1).trim()]);
        } else if (arg === '--origin') {
            const origin = value();
            try { options.origin = new URL(origin).origin; } catch { usage(`--origin is not an origin: ${origin}`); }
            if (options.origin === 'null') usage(`--origin is not an http(s) origin: ${origin}`);
        } else if (arg === '--type') {
            options.type = value();
        } else if (arg === '--only') {
            options.only.push(...value().split(',').map(name => name.trim()).filter(Boolean));
        } else if (arg === '--keep' || arg === '--json' || arg === '--list') {
            options[arg.slice(2)] = true;
        } else if (arg === '--help' || arg === '-h') {
            usage();
        } else if (arg.startsWith('-')) {
            usage(`unknown option ${arg}`);
        } else if (options.url) {
            usage('one url only');
        } else {
            options.url = arg;
        }
    }
    const unknown = options.only.filter(name => !CASES.some(c => c.name === name));
    if (unknown.length) usage(`no case named ${unknown.join(', ')}; --list names them`);
    if (!options.list) {
        if (!options.url) usage('the receiver url is required');
        try {
            if (!/^https?:$/.test(new URL(options.url).protocol)) usage('the url must be http or https');
        } catch { usage(`not a url: ${options.url}`); }
    }
    return options;
}

const LABELS = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', check: 'CHECK', skip: 'SKIP' };
const COLORS = { pass: 32, fail: 31, warn: 33, check: 36, skip: 90 };

async function main() {
    const options = parseOptions(process.argv.slice(2));
    const color = !options.json && process.stdout.isTTY && !process.env.NO_COLOR;
    const paint = (outcome, text) => (color ? `\x1b[${COLORS[outcome]}m${text}\x1b[0m` : text);
    const width = Math.max(...CASES.map(c => c.name.length)) + 2;

    if (options.list) {
        for (const c of CASES) process.stdout.write(`${c.name.padEnd(width)}${c.what}\n`);
        return 0;
    }

    const run = new Run(options);
    const cases = CASES.filter(c => options.only.length === 0 || options.only.includes(c.name));
    const out = text => { if (!options.json) process.stdout.write(`${text}\n`); };
    out(`Feedback protocol conformance (schemaVersion 1): ${options.url}`);
    out(options.keep
        ? 'The reports are sent unmarked (--keep).'
        : `Every report's message starts with ${MARKER}, so the reports can be found and deleted on the receiving side.`);
    out('');

    const results = [];
    for (const c of cases) {
        run.caseName = c.name;
        const seen = run.answers.length;
        let result;
        try {
            result = await c.run(run);
        } catch (error) {
            result = fail(`the check itself failed: ${error.stack || error}`);
        }
        results.push({ name: c.name, what: c.what, ...result, answers: run.answers.slice(seen) });
        out(`  ${paint(result.outcome, LABELS[result.outcome].padEnd(6))}${c.name.padEnd(width)}${result.detail}`);
    }

    const count = outcome => results.filter(r => r.outcome === outcome).length;
    const checks = results.filter(r => r.check).map(r => `${r.name}: ${r.check}`);
    if (results.some(r => r.outcome !== 'skip' && r.outcome !== 'fail' || r.check)) {
        checks.push('Every stored file is served only to those who may read reports, with its stored type, X-Content-Type-Options: nosniff and Content-Security-Policy: default-src \'none\'; sandbox.');
        if (!options.keep) checks.push(`Delete the reports whose message starts with ${MARKER}.`);
    }
    const notTested = 'Not tested from outside: a rate limit (an open receiver limits by address), an origin allowlist on an open receiver, and that a retry stored nothing.';
    const ok = count('fail') === 0;

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            receiver: options.url, schemaVersion: 1, marker: options.keep ? null : MARKER, ok,
            summary: { pass: count('pass'), fail: count('fail'), warn: count('warn'), check: count('check'), skip: count('skip') },
            cases: results, checksByHand: checks, notTested,
        }, null, 2)}\n`);
        return ok ? 0 : 1;
    }
    out('');
    out(`${count('pass')} passed, ${count('fail')} failed, ${count('warn')} warnings, ${count('check')} to check by hand, ${count('skip')} skipped: ${ok ? paint('pass', 'conforms') : paint('fail', 'does not conform')}`);
    if (checks.length) {
        out('');
        out('Check by hand on the receiving side:');
        checks.forEach((text, i) => out(`  ${i + 1}. ${text}`));
    }
    out('');
    out(notTested);
    return ok ? 0 : 1;
}

if (require.main === module) {
    main().then(code => process.exit(code), error => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
}
module.exports = { classify, refusedAs, CASES };
