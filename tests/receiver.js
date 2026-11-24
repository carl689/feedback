/*
 * The throwaway receiver and static server the widget's tests run against. No dependencies.
 *
 * Playwright's config uses this file as its globalSetup: it starts one server on a free port and
 * puts its address in process.env.FEEDBACK_BASE for the tests. Run by hand with
 * `node receiver.js [port]` to click through the test pages.
 *
 * What it serves:
 *   GET  /feedback.js, /feedbackPanel.js     the widget's two files from the directory above
 *   GET  /v2/feedbackPanel.js                 the panel with its version changed to 2.0.0
 *   GET  /pages/<name>                        tests/pages/<name>; a page named csp-* is sent with the
 *                                             strict Content-Security-Policy the README promises works
 *   POST /receive/<channel>                   a report: stored, then answered by the channel's script
 *   POST /script/<channel>                    JSON, one answer or a list: how the next posts are answered
 *   GET  /received/<channel>                  every report the channel received, parsed
 *   GET  /site/<name>                         tests/pages/site/<name>, the multi-page test site; {{OTHER}} and
 *                                             {{FIRST}} in it become the two origins
 *                                             ?csp=strict sends it with the strict policy, ?csp=frames
 *                                             with that and frame-src 'self'
 *   GET  /download/<name>                     a file sent as an attachment (a download)
 *   POST /post-echo                           a form posted: answered with a page naming its fields and files
 *   POST /post-redirect                       a form posted: answered 302 to /site/walk-c.html?posted=1
 *   GET  /nothing                             204, no content: a navigation that never commits
 *   GET  /to-other[?deny=1]                   302 to the second origin's page (that one refuses framing)
 *   GET  /elsewhere                           where a redirect answer points; nothing should arrive
 *   ANY  /proxy/<port>/<path>                 passed to 127.0.0.1:<port>/<path> and its answer passed back,
 *                                             so a page here can post to another receiver (the
 *                                             examples) as its own origin, which answers no CORS
 *
 * An answer is {status, json, text, type, headers, delayMs, redirect, drop}: json is sent as JSON,
 * text as it is (with type), redirect answers 307 to that path, drop closes the socket unanswered.
 * A channel with no script left answers 200 {"id": "<n>"}, n counting that channel's reports.
 * Each test uses its own channel, so tests in parallel never see each other's reports.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const {Readable} = require('stream');

// FEEDBACK_WIDGET_DIR serves another build of the two files (to see a test fail on an older one)
const WIDGET = process.env.FEEDBACK_WIDGET_DIR || path.join(__dirname, '..');
const PAGES = path.join(__dirname, 'pages');
const STRICT_CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; style-src 'none'";
const TYPES = {'.js': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.png': 'image/png'};
const SITE = path.join(PAGES, 'site');
const escapeHtml = v => String(v).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** A page of the test site, with the two origins filled in. */
function serveSite(res, name, origins, extraHeaders = {}) {
    if (!/^[\w.-]+$/.test(name)) {
        res.writeHead(404, {'Content-Type': 'text/plain'});
        return res.end('not found');
    }
    fs.readFile(path.join(SITE, name), 'utf8', (err, text) => {
        if (err) {
            res.writeHead(404, {'Content-Type': 'text/plain'});
            return res.end('not found');
        }
        res.writeHead(200, Object.assign({'Content-Type': TYPES[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-store'}, extraHeaders));
        res.end(text.replaceAll('{{OTHER}}', origins.other).replaceAll('{{FIRST}}', origins.first));
    });
}

/** The second origin: a page that allows framing, one that refuses it, and one that frames the first origin. */
function createOther(origins) {
    return http.createServer((req, res) => {
        const name = new URL(req.url, 'http://other').pathname.slice(1);
        serveSite(res, name, origins, name === 'other-deny.html' ? {'X-Frame-Options': 'DENY'} : {});
    });
}

function createReceiver(origins = {first: '', other: ''}) {
    const scripts = new Map();
    const received = new Map();
    const elsewhere = [];

    async function readReport(req) {
        const request = new Request('http://receiver' + req.url, {method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half'});
        const form = await request.formData();
        const entry = {fields: {}, report: null, reportText: null, files: {}, headers: {
            origin: req.headers.origin || null, contentType: req.headers['content-type'] || null,
            secFetchSite: req.headers['sec-fetch-site'] || null, custom: req.headers['x-feedback-test'] || null
        }, order: []};
        for (const [name, value] of form.entries()) {
            entry.order.push(name);
            if (typeof value === 'string') {
                if (name === 'report') {
                    entry.reportText = value;
                    try { entry.report = JSON.parse(value); } catch {}
                } else entry.fields[name] = value;
            } else {
                const bytes = Buffer.from(await value.arrayBuffer());
                entry.files[name] = {filename: value.name, type: value.type, size: bytes.length, base64: bytes.toString('base64')};
            }
        }
        return entry;
    }

    function answer(res, a) {
        if (a.drop) return res.socket.destroy();
        if (a.redirect) {
            res.writeHead(307, {Location: a.redirect});
            return res.end();
        }
        const headers = Object.assign({}, a.headers || {});
        let body = '';
        if (a.json !== undefined) {
            body = JSON.stringify(a.json);
            headers['Content-Type'] = 'application/json';
        } else if (a.text !== undefined) {
            body = a.text;
            headers['Content-Type'] = a.type || 'text/plain';
        }
        res.writeHead(a.status || 200, headers);
        res.end(body);
    }

    function serveFile(res, file, extraHeaders) {
        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                return res.end('not found');
            }
            res.writeHead(200, Object.assign({'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store'}, extraHeaders));
            res.end(data);
        });
    }

    return http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://receiver');
        const [, first, rest] = url.pathname.match(/^\/([^/]*)\/?(.*)$/) || [];
        try {
            if (req.method === 'GET' && (url.pathname === '/feedback.js' || url.pathname === '/feedbackPanel.js')) {
                return serveFile(res, path.join(WIDGET, url.pathname));
            }
            if (req.method === 'GET' && url.pathname === '/v2/feedbackPanel.js') {
                const source = fs.readFileSync(path.join(WIDGET, 'feedbackPanel.js'), 'utf8').replace(/const VERSION = '[^']+'/, "const VERSION = '2.0.0'");
                res.writeHead(200, {'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store'});
                return res.end(source);
            }
            if (req.method === 'GET' && first === 'pages' && /^[\w.-]+$/.test(rest)) {
                return serveFile(res, path.join(PAGES, rest), rest.startsWith('csp-') ? {'Content-Security-Policy': STRICT_CSP} : {});
            }
            if (req.method === 'GET' && first === 'site') {
                // ?csp=strict: the strict policy; ?csp=frames: it with frame-src 'self', what a recording across pages needs
                const csp = url.searchParams.get('csp');
                return serveSite(res, rest, origins, csp === 'strict' ? {'Content-Security-Policy': STRICT_CSP}
                    : csp === 'frames' ? {'Content-Security-Policy': STRICT_CSP + "; frame-src 'self'"} : {});
            }
            if (req.method === 'GET' && first === 'download') {
                res.writeHead(200, {'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="report.csv"'});
                return res.end('a,b\n1,2\n');
            }
            if (req.method === 'GET' && url.pathname === '/nothing') {
                res.writeHead(204);
                return res.end();
            }
            if (req.method === 'GET' && url.pathname === '/to-other') {
                res.writeHead(302, {Location: `${origins.other}/${url.searchParams.get('deny') ? 'other-deny' : 'other'}.html`});
                return res.end();
            }
            if (req.method === 'POST' && url.pathname === '/post-redirect') {
                for await (const chunk of req) void chunk;
                res.writeHead(302, {Location: '/site/walk-c.html?posted=1'});
                return res.end();
            }
            if (req.method === 'POST' && url.pathname === '/post-echo') {
                const request = new Request('http://receiver/', {method: 'POST', headers: req.headers, body: Readable.toWeb(req), duplex: 'half'});
                const form = await request.formData();
                const items = [...form.entries()].map(([k, v]) => `<li data-name="${escapeHtml(k)}">${escapeHtml(k)}=${escapeHtml(typeof v === 'string' ? v : `file ${v.name} ${v.size}`)}</li>`);
                res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
                return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Posted</title><link rel="icon" href="data:,">` +
                    `<script src="/feedback.js" defer></script><script src="/site/site.js" defer></script></head>` +
                    `<body><h1>Posted</h1><ul id="posted">${items.join('')}</ul><a id="toA" href="/site/walk-a.html">Page A</a></body></html>`);
            }
            if (first === 'proxy' && /^\d+\//.test(rest)) {
                // another receiver on this machine, made same-origin for a page: /proxy/<port>/<path>
                const [, port, upstreamPath] = rest.match(/^(\d+)\/(.*)$/);
                const upstream = http.request({
                    host: '127.0.0.1', port: Number(port), path: '/' + upstreamPath + url.search, method: req.method,
                    headers: Object.assign({}, req.headers, {host: `127.0.0.1:${port}`})
                }, answer => {
                    res.writeHead(answer.statusCode, answer.headers);
                    answer.pipe(res);
                });
                upstream.on('error', e => {
                    res.writeHead(502, {'Content-Type': 'text/plain'});
                    res.end(String(e));
                });
                return req.pipe(upstream);
            }
            if (first === 'elsewhere') {
                elsewhere.push(req.method);
                res.writeHead(200, {'Content-Type': 'application/json'});
                return res.end('{"id":"elsewhere"}');
            }
            if (req.method === 'POST' && first === 'script') {
                let raw = '';
                for await (const chunk of req) raw += chunk;
                const list = JSON.parse(raw);
                scripts.set(rest, Array.isArray(list) ? list : [list]);
                res.writeHead(204);
                return res.end();
            }
            if (req.method === 'GET' && first === 'received') {
                res.writeHead(200, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify(received.get(rest) || []));
            }
            if (req.method === 'GET' && url.pathname === '/elsewhere-count') {
                res.writeHead(200, {'Content-Type': 'application/json'});
                return res.end(JSON.stringify(elsewhere.length));
            }
            if (req.method === 'POST' && first === 'receive') {
                const entry = await readReport(req);
                const list = received.get(rest) || [];
                list.push(entry);
                received.set(rest, list);
                const queue = scripts.get(rest) || [];
                const a = queue.length ? queue.shift() : {status: 200, json: {id: String(list.length)}};
                if (a.delayMs) await new Promise(r => setTimeout(r, a.delayMs));
                return answer(res, a);
            }
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end('not found');
        } catch (e) {
            res.writeHead(500, {'Content-Type': 'text/plain'});
            res.end(String(e && e.stack || e));
        }
    });
}

/** The receiver and the second origin, each on a free port (or the receiver on the port given). */
async function start(port = 0) {
    const origins = {first: '', other: ''};
    const server = createReceiver(origins);
    const other = createOther(origins);
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
    origins.first = `http://127.0.0.1:${server.address().port}`;
    origins.other = `http://127.0.0.1:${other.address().port}`;
    server.other = other;
    server.origins = origins;
    return server;
}

/** Playwright globalSetup: one receiver for the whole run, torn down when it ends. */
module.exports = async function globalSetup() {
    const server = await start(0);
    process.env.FEEDBACK_BASE = server.origins.first;
    process.env.FEEDBACK_OTHER = server.origins.other;
    const stop = s => new Promise(resolve => {
        s.close(resolve);
        s.closeAllConnections();
    });
    return () => Promise.all([stop(server), stop(server.other)]);
};
module.exports.start = start;

if (require.main === module) {
    start(Number(process.argv[2]) || 0).then(server => {
        console.log(`receiver on http://127.0.0.1:${server.address().port}/pages/demo.html`);
    });
}
