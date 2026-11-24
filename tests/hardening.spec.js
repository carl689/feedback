// What a hostile or careless page can do to the widget, and what the widget does about it: a
// polluted Object.prototype, a second copy, cuts through a surrogate pair, reset() in the middle of
// things, focus after a refusal, and the review's smaller findings (L1 to L15).
'use strict';
const fs = require('fs');
const path = require('path');
const {test, expect, openPanel, sendReport, pageHtml} = require('./fixtures');

const WIDGET = process.env.FEEDBACK_WIDGET_DIR || path.join(__dirname, '..');
const dialogOf = page => page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
const errorsSaying = (log, text) => log.filter(m => m.type === 'error' && m.text.includes(text));
const warningsSaying = (log, text) => log.filter(m => m.type === 'warning' && m.text.includes(text));
/** Serves raw HTML at a fresh address on the test origin and goes there. */
async function rawPage(page, base, html) {
    const url = `${base}/gen/raw-${Math.random().toString(36).slice(2, 8)}.html`;
    await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html}));
    await page.goto(url);
}

test.describe('H1: a polluted Object.prototype', () => {
    // every setting, label, draft and answer name the widget reads, set on Object.prototype before the stub runs
    const NAMES = ['endpoint', 'project', 'environment', 'release', 'context', 'user', 'credentials', 'headers', 'fields', 'timeoutMs',
        'types', 'defaultType', 'messageMaxLength', 'labels', 'locale', 'trigger', 'launcher', 'zIndex', 'theme', 'collect',
        'errorBufferSize', 'requestCount', 'scrubParams', 'scrubPatterns', 'screenshot', 'video', 'panelSrc', 'panelIntegrity',
        'beforeSend', 'onOpen', 'onSent', 'onError', 'error', 'id', 'message', 'code', 'field', 'page', 'title', 'sendButton',
        'launcher', 'finishing', 'closeAfterStop', 'blocked', 'node', 'status', 'retryAt', 'text', 'Escape', 'bug'];
    const pollute = `<script>
        window.__hooks = [];
        for (const k of ${JSON.stringify(NAMES)}) {
            const hook = function () { window.__hooks.push(k); return {}; };
            Object.prototype[k] = /^(beforeSend|onOpen|onSent|onError|headers)$/.test(k) ? hook
                : k === 'launcher' ? true : k === 'endpoint' || k === 'panelSrc' ? 'https://polluted.invalid/x'
                : k === 'trigger' ? 'button' : k === 'timeoutMs' || k === 'zIndex' ? 1 : 'polluted';
        }
    </script>`;

    test('the widget behaves exactly as on a clean page', async ({page, load, receiver, consoleLog}) => {
        await load({head: pollute, init: true, body: '<button type="button" id="plain">Not a trigger</button>'});
        // no launcher from the polluted launcher, no trigger from the polluted selector
        await expect(page.getByRole('button')).toHaveCount(2);
        await page.locator('#plain').click();
        await expect(dialogOf(page)).toHaveCount(0);
        const p = await sendReport(page, {message: 'from a dirty page'});
        await expect(p.done).toContainText('Sent, #1');
        const [entry] = await receiver.reports(1);
        expect(entry.report.message).toBe('from a dirty page');
        expect(JSON.stringify(entry.report)).not.toContain('polluted');
        expect(entry.fields).toEqual({});
        expect(await page.evaluate(() => window.__hooks)).toEqual([]);
        expect(consoleLog.filter(m => /feedback:/.test(m.text))).toEqual([]);
    });
});

test.describe('M1: settings from markup', () => {
    test('an endpoint on another origin is refused from a data attribute', async ({page, load, consoleLog}) => {
        await load({attrs: {endpoint: 'https://reports.example/collect'}});
        await expect.poll(() => warningsSaying(consoleLog, '"endpoint" is not valid').length).toBe(1);
        await page.locator('#trigger').click();
        await page.waitForTimeout(300);
        await expect(dialogOf(page)).toHaveCount(0);
    });

    test('an endpoint on another origin is taken from init()', async ({page, load, consoleLog}) => {
        await load({init: `{endpoint: 'https://reports.example/collect'}`});
        await openPanel(page);
        expect(warningsSaying(consoleLog, 'not valid')).toEqual([]);
    });

    for (const [name, second, errors] of [['different settings', '/receive/elsewhere', 1], ['the same settings', null, 0]]) {
        test(`a second copy with ${name} ${errors ? 'says which copy is in charge' : 'is quiet'}`, async ({page, base, endpoint, consoleLog}) => {
            await rawPage(page, base, `<!doctype html><title>Two copies</title><script src="/feedback.js" data-endpoint="${endpoint}"></script>` +
                `<script src="/feedback.js?again" data-endpoint="${second || endpoint}"></script><button id="trigger" data-feedback>Go</button>`);
            await page.waitForTimeout(200);
            expect(errorsSaying(consoleLog, 'loaded twice with different settings; the copy that ran first is in charge')).toHaveLength(errors);
            await openPanel(page);
        });
    }
});

test.describe('M2: cuts and well-formed text', () => {
    test('the title, an error message and the message are cut whole, and the context is well formed', async ({page, load, endpoint, receiver}) => {
        await load({title: 'a'.repeat(199) + '\u{1F600}', init: `{endpoint: '${endpoint}', context: {lone: 'x\\uD800y', ['k\\uDC00']: 1}}`});
        await page.evaluate(() => console.error('b'.repeat(499) + '\u{1F600} expected-in-test'));
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('m'.repeat(10));
        await p.send.click();
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        const r = entry.report;
        expect(r.title).toBe('a'.repeat(199));
        expect(r.errors[0].message).toBe('b'.repeat(499));
        expect(r.context).toEqual({lone: 'x�y', 'k�': 1});
        expect(entry.reportText.isWellFormed()).toBe(true);
        expect(entry.reportText).not.toMatch(/\\u[dD][89abAB]/);
    });
});

test.describe('M3: scrubbing', () => {
    test('cards beside other digits, names in any text, nested and relative URLs, and added names are blanked', async ({page, load, endpoint, receiver, base}) => {
        await load({init: `{endpoint: '${endpoint}', scrubParams: ['custom']}`});
        const secrets = await page.evaluate(async () => {
            const lines = [
                '{"password":"hunter2","token":"tok123","otp":123456}', 'card 4111 1111 1111 1111 ok', 'card 4111  1111  1111  1111 ok',
                'card 4111.1111.1111.1111 ok', 'card 4111 1111 1111 1111 ok', 'order 12 4111111111111111', 'cc4111111111111111',
                'Authorization: Basic dXNlcjpwYXNz', 'apikey=APIKEYSECRET sid=SIDSECRET session=SESSSECRET pwd=PWDSECRET',
                'POST /api/login?token=RELSECRET failed', 'go /cb?next=/inner?access_token=INNERSECRET'];
            for (const l of lines) console.error(l + ' expected-in-test');
            for (const q of ['next=/cb?token=NESTEDSECRET', 'token=abc;SEMISECRET', 'custom=CUSTOMSECRET&token=TOKENSECRET&q=kept'])
                await fetch('/pages/missing-' + Math.random().toString(36).slice(2) + '?' + q).catch(() => {});
            return ['hunter2', 'tok123', '123456', '4111', 'dXNlcjpwYXNz', 'APIKEYSECRET', 'SIDSECRET', 'SESSSECRET', 'PWDSECRET',
                'RELSECRET', 'INNERSECRET', 'NESTEDSECRET', 'SEMISECRET', 'CUSTOMSECRET', 'TOKENSECRET'];
        });
        const p = await sendReport(page, {message: 'scrub'});
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        const text = JSON.stringify(entry.report);
        expect(secrets.filter(s => text.includes(s))).toEqual([]);
        expect(entry.report.requests.length).toBe(3);
        expect(text).toContain('q=kept');
        expect(text).toContain('order 12');
    });
});

test.describe('M4: reset()', () => {
    test('a request failed before reset() is not reported after it', async ({page, load, receiver}) => {
        await load({init: true});
        await page.evaluate(() => fetch('/pages/missing-before-reset').catch(() => {}));
        await page.waitForTimeout(200);
        await page.evaluate(() => feedback.reset());
        await page.evaluate(() => fetch('/pages/missing-after-reset').catch(() => {}));
        const p = await sendReport(page, {message: 'after reset'});
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(entry.report.requests.map(r => r.url)).toEqual([expect.stringContaining('missing-after-reset')]);
    });

    test('a screenshot answered after reset() is not attached', async ({page, load, receiver}) => {
        await page.addInitScript(() => {
            const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getDisplayMedia = o => new Promise(r => setTimeout(r, 800)).then(() => real(o));
        });
        await load({init: true});
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
        await page.waitForTimeout(200);
        await page.evaluate(() => feedback.reset());
        await page.waitForTimeout(1500);
        await openPanel(page);
        await expect(p.dialog.getByRole('img')).toHaveCount(0);
        await p.type('Bug').click();
        await p.message.fill('no screenshot');
        await p.send.click();
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(Object.keys(entry.files)).toEqual([]);
        expect(entry.report.attachments).toBeUndefined();
    });

    test('a send in flight at reset() has its answer ignored', async ({page, load, receiver}) => {
        await load({init: true});
        await receiver.script({status: 201, json: {id: 'late'}, delayMs: 1200});
        const p = await sendReport(page, {message: 'in flight'});
        await page.waitForTimeout(200);
        await page.evaluate(() => feedback.reset());
        await page.waitForTimeout(1600);
        await expect(p.dialog).toHaveCount(0);
        await openPanel(page);
        await expect(p.done).toBeHidden();
        await expect(p.message).toHaveValue('');
        await expect(p.send).toHaveText('Send');
    });

    test('a panel still loading at reset() does not open', async ({page, load}) => {
        await page.route('**/feedbackPanel.js*', async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
        await load({init: true});
        await page.locator('#trigger').click();
        await page.evaluate(() => feedback.reset());
        await page.waitForTimeout(1500);
        await expect(dialogOf(page)).toHaveCount(0);
        await openPanel(page);
    });
});

test.describe('M5: focus while sending and after a refusal', () => {
    test('the Send button keeps focus while busy, a second press sends nothing, and after a refusal focus is on Send', async ({page, load, receiver}) => {
        await load({init: true});
        await receiver.script({status: 400, json: {error: {code: 'invalid', message: 'Not this time.'}}, delayMs: 800});
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('refused');
        await p.send.focus();
        await page.keyboard.press('Enter');
        await expect(p.send).toHaveAttribute('aria-disabled', 'true');
        expect(await p.send.evaluate(b => b.disabled)).toBe(false); // not disabled: focus would fall to the body
        await page.keyboard.press('Enter');
        await expect(p.alert).toContainText('Not this time.');
        expect(await receiver.received()).toHaveLength(1);
        await expect.poll(() => page.locator('[data-feedback-panel]').evaluate(h => h.shadowRoot.activeElement && h.shadowRoot.activeElement.textContent)).toBe('Send');
        await page.keyboard.press('Escape');
        await expect(p.dialog).toHaveCount(0);
    });

    test('after a 415 focus is on the offer to send without the file', async ({page, load, receiver}) => {
        await load({init: true});
        await receiver.script({status: 415, json: {error: {code: 'unsupportedMedia', field: 'screenshot'}}});
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('with a screenshot');
        await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
        await expect(p.dialog.getByRole('img')).toHaveCount(1);
        await p.send.click();
        await expect.poll(() => page.locator('[data-feedback-panel]').evaluate(h => h.shadowRoot.activeElement && h.shadowRoot.activeElement.textContent)).toBe('Send without the screenshot');
    });
});

test.describe('the smaller findings', () => {
    test('L1: the hub takes a panel only while it is loading one', async ({page, load}) => {
        await load({init: true});
        await page.evaluate(() => window[Symbol.for('feedback.stub')].attach('1.2.0', () => ({open() { window.__hijacked = 1; }, close() {}, reset() {}, setContext() {}})));
        await openPanel(page);
        expect(await page.evaluate(() => window.__hijacked)).toBeUndefined();
    });

    test('L2: a trigger that is not a selector falls back to the default one', async ({page, load, consoleLog}) => {
        await load({attrs: {trigger: '[['}});
        await openPanel(page);
        expect(warningsSaying(consoleLog, '"trigger" is not valid; the default is used')).toHaveLength(1);
    });

    test('L3: a launcher position that is not text, and a stub in <head> with no defer, still draw the launcher', async ({page, base, endpoint, consoleLog}) => {
        await rawPage(page, base, `<!doctype html><title>Sync</title><script src="/feedback.js" data-endpoint="${endpoint}" data-launcher='{"position": ["top-left"]}'></script><body><p>x</p></body>`);
        const launcher = page.getByRole('button', {name: 'Feedback'});
        await expect(launcher).toBeVisible();
        await launcher.click();
        await expect(dialogOf(page)).toBeVisible();
        expect(consoleLog.filter(m => m.type === 'error')).toEqual([]);
    });

    test('L3: an inline copy of the stub runs, and opens with a panelSrc', async ({page, base, endpoint, consoleLog}) => {
        const stub = fs.readFileSync(path.join(WIDGET, 'feedback.js'), 'utf8');
        await rawPage(page, base, `<!doctype html><title>Inline</title><script data-endpoint="${endpoint}" data-panel-src="/feedbackPanel.js">${stub}</script>` +
            '<button id="trigger" data-feedback>Go</button>');
        await openPanel(page);
        expect(consoleLog.filter(m => m.type === 'error')).toEqual([]);
    });

    test('L12: a stub loaded as a module reads no attributes, says so, and works from init() with panelSrc', async ({page, base, endpoint, consoleLog}) => {
        await rawPage(page, base, `<!doctype html><title>Module</title><script type="module" src="/feedback.js" data-endpoint="${endpoint}"></script><p>x</p>`);
        await expect.poll(() => warningsSaying(consoleLog, 'no "endpoint" is set, so the widget is off (no data- attributes read: a module script has none)').length).toBe(1);
        for (const [settings, opens] of [[`{endpoint: '${endpoint}'}`, false], [`{endpoint: '${endpoint}', panelSrc: '/feedbackPanel.js'}`, true]]) {
            await rawPage(page, base, `<!doctype html><title>Module</title><script type="module" src="/feedback.js"></script>` +
                `<script type="module">feedback.init(${settings});</script><button id="trigger" data-feedback>Go</button>`);
            await page.locator('#trigger').click();
            if (opens) await expect(dialogOf(page)).toBeVisible();
            else await expect.poll(() => errorsSaying(consoleLog, 'there is no panel to load: see panelSrc and panelIntegrity').length).toBe(1);
        }
    });

    test('L4: the console wrapper never throws and keeps a huge object short', async ({page, load, endpoint, receiver}) => {
        await load({init: true});
        const outcome = await page.evaluate(() => {
            const {proxy, revoke} = Proxy.revocable({}, {});
            revoke();
            const thrower = {get x() { throw new Error('getter'); }};
            const huge = Object.fromEntries(Array.from({length: 100000}, (_, i) => ['k' + i, i]));
            const t = performance.now();
            try {
                console.error(proxy);
                console.error(thrower);
                console.error('huge expected-in-test', huge);
            } catch (e) { return 'threw: ' + e; }
            return performance.now() - t;
        });
        expect(typeof outcome).toBe('number');
        expect(outcome).toBeLessThan(250);
        const p = await sendReport(page, {message: 'console'});
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(entry.report.errors.map(e => [e.message, e.count])).toEqual([['[object]', 2], ['huge expected-in-test [object]', 1]]);
    });

    test('L5: a malformed panelIntegrity loads no panel at all', async ({page, load, consoleLog}) => {
        let asked = 0;
        await page.route('**/feedbackPanel.js*', route => { asked++; return route.continue(); });
        await load({attrs: {panelIntegrity: 'not-a-hash'}});
        await page.locator('#trigger').click();
        await expect.poll(() => errorsSaying(consoleLog, 'there is no panel to load').length).toBe(1);
        expect(warningsSaying(consoleLog, '"panelIntegrity" is not valid')).toHaveLength(1);
        await expect(dialogOf(page)).toHaveCount(0);
        expect(asked).toBe(0);
    });

    for (const where of ['constructor', 'start']) {
        test(`L6: a MediaRecorder whose ${where} throws stops the screen capture`, async ({page, load}) => {
            await page.addInitScript(where => {
                const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getDisplayMedia = async o => (window.__stream = await real(o));
                const Real = window.MediaRecorder;
                window.MediaRecorder = class extends Real {
                    constructor(...a) { if (where === 'constructor') throw new Error('expected-in-test'); super(...a); }
                    start() { throw new Error('expected-in-test'); }
                    static isTypeSupported(t) { return Real.isTypeSupported(t); }
                };
            }, where);
            await load({init: true});
            const p = await openPanel(page);
            await p.type('Bug').click();
            await p.dialog.getByRole('button', {name: 'Record screen'}).click();
            await expect(p.dialog.getByText('The screen could not be captured.')).toBeVisible();
            await expect.poll(() => page.evaluate(() => window.__stream && window.__stream.getTracks().every(t => t.readyState === 'ended'))).toBe(true);
        });
    }

    test('L8: the preview follows errors that arrive while it is open, and names the form fields', async ({page, load}) => {
        await load({init: `{endpoint: '/receive/x', fields: {tenant: 't1', area: 'a'}}`});
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('preview');
        await p.showPreview.click();
        await expect(p.preview).not.toContainText('late arrival');
        await page.evaluate(() => console.error('late arrival expected-in-test'));
        await expect(p.preview).toContainText('late arrival');
        await expect(p.dialog.getByText('Sent with it, as form fields: tenant=t1, area=a.')).toBeVisible();
    });

    test('L9: a beforeSend that never settles ends in the failure row within timeoutMs', async ({page, load, endpoint, receiver, consoleLog}) => {
        await load({init: `{endpoint: '${endpoint}', timeoutMs: 1500, beforeSend: () => new Promise(() => {})}`});
        const p = await sendReport(page, {message: 'never'});
        await expect(p.alert).toBeVisible({timeout: 4000});
        await expect(p.send).toHaveText('Retry');
        expect(errorsSaying(consoleLog, 'beforeSend did not settle within timeoutMs')).toHaveLength(1);
        expect(await receiver.received()).toEqual([]);
    });

    test('L9: what beforeSend gives back is held to the protocol again', async ({page, load, endpoint, receiver, consoleLog}) => {
        await load({init: `{endpoint: '${endpoint}', beforeSend: r => window.__strip ? {message: r.message} : Object.assign(r, {message: 'z'.repeat(9000), errors: Array.from({length: 80}, (_, i) => ({kind: 'exception', message: 'e' + i}))})}`});
        await page.evaluate(() => { window.__strip = true; });
        const p = await sendReport(page, {message: 'stripped'});
        await expect.poll(() => errorsSaying(consoleLog, 'the report from beforeSend is not JSON or lacks a required field, so nothing was sent').length).toBe(1);
        await expect(p.send).toHaveText('Send');
        await page.evaluate(() => { window.__strip = false; });
        await p.send.click();
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(entry.report.message.length).toBe(5000);
        expect(entry.report.errors).toHaveLength(50);
        expect(entry.report.errors[49].message).toBe('e79');
    });

    test('L11: a trigger inside a shadow root opens the panel', async ({page, load}) => {
        await load({init: true, body: '<div id="host"></div><script>document.getElementById("host").attachShadow({mode: "open"}).innerHTML = \'<button id="inner" data-feedback>In a shadow root</button>\';</script>'});
        await page.locator('#inner').click();
        await expect(dialogOf(page)).toBeVisible();
    });

    test('L13: an element named title or referrer does not stand in for the document\'s', async ({page, load, receiver}) => {
        await load({init: true, title: 'The real title', body: '<form name="title"></form><form name="referrer"></form>'});
        expect(await page.evaluate(() => String(document.title))).not.toBe('The real title'); // clobbered for the page itself
        const p = await sendReport(page, {message: 'clobbered'});
        await expect(p.done).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(entry.report.title).toBe('The real title');
        expect(entry.report.referrer).toBeUndefined();
    });

    test('L14: with no displaySurface constraint and anySurface: false the capture buttons are not offered', async ({page, load}) => {
        await page.addInitScript(() => { MediaDevices.prototype.getSupportedConstraints = () => ({width: true, height: true}); });
        await load({init: `{endpoint: '/receive/x', anySurface: false}`});
        const p = await openPanel(page);
        await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toHaveCount(0);
        await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toHaveCount(0);
    });

    for (const [z, expected] of [['"high"', '2147483000'], ['1e12', '2147483000'], ['-4', '2147483000'], ['5', '5']]) {
        test(`L15: a launcher zIndex of ${z} gives ${expected}`, async ({page, load}) => {
            await load({attrs: {launcher: 'true', zIndex: z}});
            const launcher = page.getByRole('button', {name: 'Feedback'});
            await expect(launcher).toBeVisible();
            expect(await launcher.evaluate(b => getComputedStyle(b).zIndex)).toBe(expected);
        });
    }
});
