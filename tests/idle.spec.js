// The idle budget: a page nobody presses the button on pays for two listeners, a console wrap and
// a click listener, and nothing else.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {test, expect, openPanel, sendReport} = require('./fixtures');

const STUB_BUDGET = 4096;

// Runs before the deferred stub: counts every call that would be a timer, an observer, a request,
// a storage read or a layout read, and every change to the document.
const WATCH = `<script>
window.__idle = {calls: {}, mutations: 0};
(() => {
    const count = name => { window.__idle.calls[name] = (window.__idle.calls[name] || 0) + 1; };
    const wrap = (owner, name, label) => {
        const original = owner[name];
        owner[name] = function (...args) { count(label || name); return original.apply(this, args); };
    };
    ['setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'fetch'].forEach(n => wrap(window, n));
    wrap(window, 'getComputedStyle');
    wrap(XMLHttpRequest.prototype, 'open', 'xhr');
    wrap(navigator, 'sendBeacon');
    wrap(Storage.prototype, 'getItem', 'storage.getItem');
    wrap(Element.prototype, 'getBoundingClientRect');
    wrap(Element.prototype, 'getClientRects');
    for (const n of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']) {
        const C = window[n];
        window[n] = class extends C { constructor(...a) { count(n); super(...a); } };
    }
    for (const p of ['offsetWidth', 'offsetHeight', 'clientWidth', 'scrollTop']) {
        const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, p) || Object.getOwnPropertyDescriptor(Element.prototype, p);
        const owner = Object.getOwnPropertyDescriptor(HTMLElement.prototype, p) ? HTMLElement.prototype : Element.prototype;
        Object.defineProperty(owner, p, Object.assign({}, d, {get() { count(p); return d.get.call(this); }}));
    }
    const C = window.MutationObserver.__proto__;
    new C(list => { window.__idle.mutations += list.length; }).observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
})();
</script>`;

test('a loaded page makes no request, no timer, no observer, no layout or storage read and no DOM change', async ({page, load, base, endpoint}) => {
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    // the watcher runs at the end of the body, before the deferred stub
    await load({body: `<button type="button" id="thrower" onclick="throw new Error('expected-in-test thrown')">Throw</button>${WATCH}`});
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__idle)));
    expect(before).toEqual({calls: {}, mutations: 0});
    expect(requests.filter(u => !u.includes('/gen/'))).toEqual([`${base}/feedback.js`]);

    // errors of every kind are buffered, and still nothing is requested or written
    await page.evaluate(() => {
        console.error('expected-in-test console error', {detail: 1});
        console.warn('expected-in-test warning');
        Promise.reject(new Error('expected-in-test rejection'));
        const img = document.createElement('img');
        img.src = '/missing-image.png';
        document.body.append(img);
    });
    await page.locator('#thrower').click();
    await expect.poll(() => requests.some(u => u.endsWith('/missing-image.png'))).toBe(true);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => window.__idle.calls);
    expect(after).toEqual({});
    expect(requests.some(u => u.includes('feedbackPanel.js'))).toBe(false);
    expect(requests.some(u => u.includes('/receive/'))).toBe(false);

    await sendReport(page);
    const [entry] = await (await page.request.get(`${base}/received/${endpoint.split('/').pop()}`)).json();
    const kinds = entry.report.errors.map(e => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['console.error', 'console.warn', 'rejection', 'resource', 'exception']));
    const consoleError = entry.report.errors.find(e => e.kind === 'console.error');
    expect(consoleError.message).toBe('expected-in-test console error {"detail":1}');
    expect(consoleError.count).toBe(1);
    const resource = entry.report.errors.find(e => e.kind === 'resource');
    expect(resource.source).toBe(`${base}/missing-image.png`);
});

test('the same error thrown in a loop fills one entry with its count', async ({page, load, receiver}) => {
    await load();
    await page.evaluate(() => { for (let i = 0; i < 25; i++) console.error('expected-in-test same'); console.error('expected-in-test other'); });
    await sendReport(page);
    const errors = (await receiver.reports(1))[0].report.errors;
    expect(errors.map(e => [e.message, e.count])).toEqual([['expected-in-test same', 25], ['expected-in-test other', 1]]);
});

test('the buffer keeps the last errorBufferSize entries, oldest first, with messages and stacks capped', async ({page, load, receiver}) => {
    await load({attrs: {errorBufferSize: 5}});
    await page.evaluate(() => {
        for (let i = 1; i <= 8; i++) console.error('expected-in-test ' + i);
        const e = new Error('expected-in-test long ' + 'x'.repeat(900));
        e.stack = 'y'.repeat(5000);
        console.error(e);
    });
    await sendReport(page);
    const errors = (await receiver.reports(1))[0].report.errors;
    expect(errors.map(e => e.message.slice(0, 18))).toEqual(['expected-in-test 5', 'expected-in-test 6', 'expected-in-test 7', 'expected-in-test 8', 'Error: expected-in']);
    expect(errors[4].message.length).toBe(500);
    expect(errors[4].stack.length).toBe(2000);
});

test('the widget\'s own warnings do not land in its buffer', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', notASetting: 1}`});
    await sendReport(page);
    expect((await receiver.reports(1))[0].report).not.toHaveProperty('errors');
});

test('the console wrap chains with a host wrap made before or after the stub', async ({page, load, receiver}) => {
    const hostWrap = `(() => { const o = console.error; console.error = function (...a) { window.__host = (window.__host || 0) + 1; return o.apply(this, a); }; })();`;
    await load({head: `<script>${hostWrap}</script>`, body: `<script type="module">${hostWrap.replace('__host', '__hostAfter').replace('__host ||', '__hostAfter ||')}</script>`});
    await page.evaluate(() => console.error('expected-in-test chained'));
    expect(await page.evaluate(() => [window.__host, window.__hostAfter])).toEqual([1, 1]);
    await sendReport(page);
    const errors = (await receiver.reports(1))[0].report.errors;
    expect(errors.map(e => e.message)).toEqual(['expected-in-test chained']);
});

test('a host that restores the console originals ends console recording, and errors are still caught', async ({page, load, receiver}) => {
    // the host wraps before the stub loads and keeps the originals for a debug-only restore
    const hostWrap = `(() => {
        const originals = {error: console.error, warn: console.warn};
        console.error = function (...a) { return originals.error.apply(this, a); };
        window.restoreConsole = () => Object.assign(console, originals);
    })();`;
    await load({head: `<script>${hostWrap}</script>`, body: '<button type="button" id="thrower" onclick="throw new Error(\'expected-in-test after restore\')">Throw</button>'});
    await page.evaluate(() => console.error('expected-in-test before restore'));
    await page.evaluate(() => window.restoreConsole());
    await page.evaluate(() => { console.error('expected-in-test not recorded'); console.warn('expected-in-test not recorded'); });
    await page.locator('#thrower').click();
    await sendReport(page);
    const errors = (await receiver.reports(1))[0].report.errors;
    expect(errors.map(e => [e.kind, e.message.replace(/^Uncaught /, '')])).toEqual([
        ['console.error', 'expected-in-test before restore'],
        ['exception', 'Error: expected-in-test after restore']
    ]);
});

test('loading the stub twice wraps the console once and opens one panel', async ({page, load, receiver, endpoint}) => {
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    await load({head: `<script src="/feedback.js" data-endpoint="${endpoint}" defer></script>`});
    await page.evaluate(() => console.error('expected-in-test once'));
    await sendReport(page);
    const errors = (await receiver.reports(1))[0].report.errors;
    expect(errors).toEqual([expect.objectContaining({message: 'expected-in-test once', count: 1})]);
    expect(requests.filter(u => u.endsWith('/feedbackPanel.js'))).toHaveLength(1);
    await expect(page.locator('[data-feedback-panel]')).toHaveCount(1);
});

test('the stub is at most 4,096 bytes gzipped', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'feedback.js'));
    const size = zlib.gzipSync(source, {level: 9}).length;
    expect(size, `feedback.js is ${size} bytes gzipped against a budget of ${STUB_BUDGET}`).toBeLessThanOrEqual(STUB_BUDGET);
});
