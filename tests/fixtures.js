// Shared fixtures for the widget's tests: a page built per test, its own receiver inbox, and a
// failure on any uncaught page error.
'use strict';
const base = require('@playwright/test');
const {expect} = base;

let pageCounter = 0;
const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const attr = v => String(v).replace(/&/g, '&amp;').replace(/'/g, '&#39;');

/** A test page: the stub with data attributes, an optional init() at DOMContentLoaded, a trigger. */
function pageHtml({attrs = {}, init = '', head = '', body = '', title = 'Feedback test page', stub = '/feedback.js', lang = 'en'}) {
    const data = Object.entries(attrs).map(([k, v]) => ` data-${kebab(k)}='${attr(typeof v === 'string' ? v : JSON.stringify(v))}'`).join('');
    const initScript = init ? `<script>document.addEventListener('DOMContentLoaded', () => feedback.init(${init}));</script>` : '';
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,">` +
        `<title>${title}</title>${head}<script src="${stub}"${data} defer></script>${initScript}</head>` +
        `<body><main><h1>A test page</h1><p>Some content to capture.</p><button type="button" id="trigger" data-feedback>Report a problem</button>${body}</main></body></html>`;
}

const test = base.test.extend({
    base: async ({}, use) => use(process.env.FEEDBACK_BASE),
    inbox: async ({}, use, testInfo) => use(`c${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`),
    endpoint: async ({inbox}, use) => use(`/receive/${inbox}`),

    /** Every console message, in order, as {type, text}. */
    consoleLog: async ({page}, use) => {
        const log = [];
        page.on('console', m => log.push({type: m.type(), text: m.text()}));
        await use(log);
    },

    /** Any uncaught error in the page fails the test. */
    failOnPageError: [async ({page}, use) => {
        const errors = [];
        // A test that throws on purpose puts expected-in-test in the message
        page.on('pageerror', e => { if (!/expected-in-test/.test(String(e))) errors.push(String(e && e.stack || e)); });
        await use();
        expect(errors, 'uncaught errors in the page').toEqual([]);
    }, {auto: true}],

    /** Serves a built page at a URL on the receiver's origin and goes to it. */
    load: async ({page, base: origin, endpoint}, use) => {
        await use(async (options = {}, query = '') => {
            const o = Object.assign({}, options);
            o.attrs = Object.assign(o.noEndpoint || o.init ? {} : {endpoint}, o.attrs || {});
            if (o.init === true) o.init = `{endpoint: '${endpoint}'}`;
            const url = `${origin}/gen/p${++pageCounter}-${Math.random().toString(36).slice(2, 6)}.html${query}`;
            const html = pageHtml(o);
            await page.route(url.split('?')[0] + '*', route => route.fulfill({
                status: 200, contentType: 'text/html; charset=utf-8', body: html, headers: o.headers || {}
            }));
            await page.goto(url);
            return url;
        });
    },

    /** The receiver's side of this test's inbox. */
    receiver: async ({request, base: origin, inbox}, use) => {
        await use({
            script: async answers => { await request.post(`${origin}/script/${inbox}`, {data: answers}); },
            received: async () => (await request.get(`${origin}/received/${inbox}`)).json(),
            /** Waits until the inbox holds n reports and answers them. */
            reports: async (n = 1) => {
                let list = [];
                await expect.poll(async () => {
                    list = await (await request.get(`${origin}/received/${inbox}`)).json();
                    return list.length;
                }, {timeout: 10000}).toBeGreaterThanOrEqual(n);
                return list;
            }
        });
    }
});

/** The panel's pieces, found through the open shadow root. */
function panel(page) {
    const dialog = page.getByRole('dialog', {name: 'Send feedback'});
    return {
        dialog,
        type: name => dialog.getByRole('radio', {name}),
        message: dialog.getByRole('textbox', {name: 'Your message'}),
        send: dialog.getByRole('button', {name: /^(Send|Retry|Sending…)$/}),
        cancel: dialog.getByRole('button', {name: 'Cancel'}),
        alert: dialog.getByRole('alert'),
        sentLine: dialog.locator('.sent-line'),
        preview: dialog.locator('pre'),
        showPreview: dialog.getByRole('button', {name: 'Show exactly what is sent'}),
        done: dialog.locator('.done'),
        close: dialog.getByRole('button', {name: 'Close'})
    };
}

async function openPanel(page) {
    await page.locator('#trigger').click();
    await expect(page.locator('[data-feedback-panel]').getByRole('dialog')).toBeVisible();
    return panel(page);
}

/** Opens the panel, picks a type, types and presses Send. */
async function sendReport(page, {type = 'Bug', message = 'Something broke'} = {}) {
    const p = await openPanel(page);
    await p.type(type).click();
    await p.message.fill(message);
    await p.send.click();
    return p;
}

module.exports = {test, expect, panel, openPanel, sendReport, pageHtml};
