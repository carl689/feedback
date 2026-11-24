// Loading the panel safely: the version handshake, panelSrc and panelIntegrity, a clobbered
// currentScript, and the nonce.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {test, expect, openPanel} = require('./fixtures');

const PANEL = fs.readFileSync(path.join(__dirname, '..', 'feedbackPanel.js'));
const sri = bytes => 'sha384-' + crypto.createHash('sha384').update(bytes).digest('base64');
const said = (log, type) => log.filter(m => m.type === type && m.text.startsWith('feedback:')).map(m => m.text);

test('a panel of another major version refuses to open and says so', async ({page, load, consoleLog}) => {
    await load({attrs: {panelSrc: '/v2/feedbackPanel.js'}});
    await page.locator('#trigger').click();
    await expect.poll(() => said(consoleLog, 'error')).toEqual([
        'feedback: the panel is version 2.0.0 and the stub is 1.2.0; deploy feedback.js and feedbackPanel.js from the same release. The panel will not open.'
    ]);
    await page.locator('#trigger').click();
    await page.waitForTimeout(200);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-feedback-panel]')).toHaveCount(0);
});

test('a panelSrc on another origin without panelIntegrity is refused and never requested', async ({page, load, consoleLog}) => {
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    await load({attrs: {panelSrc: 'https://cdn.example.invalid/feedbackPanel.js'}});
    expect(said(consoleLog, 'warning')).toEqual(['feedback: "panelSrc" is not valid; the default is used']);
    await page.locator('#trigger').click();
    await expect.poll(() => said(consoleLog, 'error')).toEqual(['feedback: there is no panel to load: see panelSrc and panelIntegrity']);
    expect(requests.some(u => u.includes('example.invalid'))).toBe(false);
});

test('a panelSrc on another origin with panelIntegrity loads with integrity and crossorigin', async ({page, load}) => {
    // integrity on a cross-origin script holds only for a CORS load, so the panel opening proves both
    await page.route('https://cdn.example.invalid/**', route => route.fulfill({
        status: 200, contentType: 'text/javascript', body: PANEL, headers: {'Access-Control-Allow-Origin': '*'}
    }));
    await load({attrs: {panelSrc: 'https://cdn.example.invalid/feedbackPanel.js', panelIntegrity: sri(PANEL)}});
    await openPanel(page);
    const script = await page.evaluate(() => {
        const s = [...document.scripts].find(x => x.src.includes('example.invalid'));
        return [s.integrity, s.crossOrigin];
    });
    expect(script).toEqual([sri(PANEL), 'anonymous']);
});

test('panelIntegrity is enforced: the right hash opens, a wrong one is refused by the browser', async ({page, load, consoleLog}) => {
    await load({attrs: {panelIntegrity: sri(PANEL)}});
    await openPanel(page);
    await page.keyboard.press('Escape');
    await load({attrs: {panelIntegrity: sri('something else')}});
    await page.locator('#trigger').click();
    await expect.poll(() => said(consoleLog, 'error').some(t => t.startsWith('feedback: could not load'))).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a clobbered document.currentScript is not trusted: its attributes are not read', async ({page, load, consoleLog, endpoint}) => {
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    await load({head: '<img name="currentScript" src="data:,">', attrs: {endpoint}});
    expect(await page.evaluate(() => document.currentScript && document.currentScript.localName)).toBe('img');
    expect(said(consoleLog, 'warning')).toEqual(['feedback: no "endpoint" is set, so the widget is off (no data- attributes read: a module script has none)']);
    await page.locator('#trigger').click();
    await page.waitForTimeout(200);
    expect(requests.some(u => u.includes('feedbackPanel.js') || u.includes('/receive/'))).toBe(false);
});

test('with a clobbered currentScript, init() still works when it names panelSrc', async ({page, load, receiver, endpoint}) => {
    await load({head: '<img name="currentScript" src="data:,">', init: `{endpoint: '${endpoint}', panelSrc: '/feedbackPanel.js'}`});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('x');
    await p.send.click();
    await receiver.reports(1);
});

test('the panel\'s script element carries the stub\'s nonce', async ({page, load, endpoint}) => {
    await load({head: `<script src="/feedback.js" nonce="n0nce-123" data-endpoint="${endpoint}" defer></script>`});
    await openPanel(page);
    expect(await page.evaluate(() => [...document.scripts].find(s => s.src.endsWith('/feedbackPanel.js')).nonce)).toBe('n0nce-123');
});

test('the panel carries the stub\'s query, so one version busts both caches; an explicit panelSrc is used as given', async ({page, load, base}) => {
    const panels = [];
    page.on('request', r => { if (r.url().includes('feedbackPanel.js')) panels.push(r.url()); });
    await load({stub: '/feedback.js?v=123'});
    await openPanel(page);
    await load();
    await openPanel(page);
    await load({stub: '/feedback.js?v=123', attrs: {panelSrc: '/feedbackPanel.js?build=9'}});
    await openPanel(page);
    expect(panels).toEqual([`${base}/feedbackPanel.js?v=123`, `${base}/feedbackPanel.js`, `${base}/feedbackPanel.js?build=9`]);
});

test('the stub\'s own load is not one of the page\'s requests, query and all', async ({page, load, receiver}) => {
    await load({stub: '/feedback.js?v=123'});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('x');
    await p.send.click();
    const r = (await receiver.reports(1))[0].report;
    expect((r.requests || []).filter(q => q.url.includes('feedback'))).toEqual([]);
});
