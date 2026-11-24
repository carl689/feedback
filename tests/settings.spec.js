// Settings: data attributes, init(), the precedence between them, and one warning per bad key.
'use strict';
const {test, expect, openPanel, sendReport} = require('./fixtures');

const warnings = log => log.filter(m => m.type === 'warning' && m.text.startsWith('feedback:')).map(m => m.text);

test('data attributes alone configure the widget, objects and lists as JSON', async ({page, load, receiver}) => {
    await load({attrs: {
        project: 'store', release: '1234567', types: ['bug', 'message'], defaultType: 'message',
        collect: {requests: false}, labels: {send: 'Submit', typeMessage: 'Note'}, messageMaxLength: 100
    }});
    await page.locator('#trigger').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('radio')).toHaveCount(2);
    await expect(dialog.getByRole('radio', {name: 'Note'})).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('textbox').fill('hello');
    await dialog.getByRole('button', {name: 'Submit'}).click();
    const r = (await receiver.reports(1))[0].report;
    expect(r).toMatchObject({project: 'store', release: '1234567', type: 'message'});
    expect(r).not.toHaveProperty('requests');
});

test('init() layers over the attributes, key by key', async ({page, load, receiver, endpoint}) => {
    await load({attrs: {endpoint, project: 'from-attribute', environment: 'staging'}, init: "{project: 'from-init'}"});
    await sendReport(page);
    const r = (await receiver.reports(1))[0].report;
    expect(r).toMatchObject({project: 'from-init', environment: 'staging'});
});

test('init() from a module script after a plain deferred tag works', async ({page, load, receiver, endpoint}) => {
    await load({noEndpoint: true, body: `<script type="module">feedback.init({endpoint: '${endpoint}', project: 'module'});</script>`});
    await sendReport(page);
    expect((await receiver.reports(1))[0].report.project).toBe('module');
});

test('a bad value is one warning naming its key and the default is used', async ({page, load, receiver, consoleLog, endpoint}) => {
    await load({
        attrs: {colour: 'red'},
        init: `{endpoint: '${endpoint}', timeoutMs: 'soon', theme: 'blue', bogus: 1, collect: {errors: 'yes', extra: true},
            video: {maxSeconds: 0, fps: 3}, labels: {send: 5, notALabel: 'x'}, types: 'bug', requestCount: 1000}`
    });
    await sendReport(page);
    await receiver.reports(1);
    expect(warnings(consoleLog).sort()).toEqual([
        'feedback: "collect.errors" must be true or false; the default is used',
        'feedback: "collect.extra" is not a setting',
        'feedback: "labels.notALabel" is not a label',
        'feedback: "labels.send" must be text of at most 300 characters',
        'feedback: "requestCount" must be an integer from 1 to 100; the default is used',
        'feedback: "theme" must be \'auto\', \'light\' or \'dark\'; the default is used',
        'feedback: "timeoutMs" must be an integer from 1000 to 600000; the default is used',
        'feedback: "types" must be a list of 1 to 10 distinct names (a-z first, then letters, digits or -); the default is used',
        'feedback: "video.fps" is not a setting',
        'feedback: "video.maxSeconds" must be an integer from 1 to 600; the default is used',
        'feedback: unknown setting bogus',
        'feedback: unknown setting data-colour'
    ]);
});

test('without an endpoint the widget is off: one warning, nothing requested, nothing drawn', async ({page, load, consoleLog, base}) => {
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    await load({noEndpoint: true, attrs: {project: 'x', launcher: true}});
    expect(warnings(consoleLog)).toEqual(['feedback: no "endpoint" is set, so the widget is off']);
    await page.locator('#trigger').click();
    await page.evaluate(() => feedback.open());
    await page.waitForTimeout(200);
    expect(requests.filter(u => !u.includes('/gen/'))).toEqual([`${base}/feedback.js`]);
    expect(await page.evaluate(() => document.body.querySelectorAll('button').length)).toBe(1);
    expect(warnings(consoleLog)).toHaveLength(1);
});

test('a second init() and an init() after the settings froze are ignored with a warning', async ({page, load, receiver, consoleLog, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', project: 'first'}`});
    await page.evaluate(() => feedback.init({project: 'second'}));
    expect(warnings(consoleLog)).toEqual(['feedback: init() came after the settings froze; ignored']);
    await sendReport(page);
    expect((await receiver.reports(1))[0].report.project).toBe('first');
});

test('settings freeze at the load event: a later init() is refused', async ({page, load, consoleLog, endpoint}) => {
    await load({noEndpoint: true});
    await page.evaluate(endpoint => feedback.init({endpoint}), endpoint);
    expect(warnings(consoleLog)).toEqual([
        'feedback: no "endpoint" is set, so the widget is off',
        'feedback: init() came after the settings froze; ignored'
    ]);
});

test('an endpoint must be https: or this page\'s origin, and resolves against the address, not <base>', async ({page, load, receiver, consoleLog, endpoint}) => {
    await load({attrs: {endpoint: 'http://example.invalid/collect'}});
    expect(warnings(consoleLog)).toEqual(['feedback: "endpoint" is not valid; the default is used']);
    consoleLog.length = 0;
    await load({attrs: {endpoint: 'javascript:alert(1)'}});
    expect(warnings(consoleLog)).toEqual(['feedback: "endpoint" is not valid; the default is used']);

    // An injected <base> would move a relative address to another host. The endpoint and an explicit
    // panelSrc resolve against the page's address; the default panelSrc beside the stub follows the
    // base, so on another origin it needs panelIntegrity and is refused
    const requests = [];
    page.on('request', r => requests.push(r.url()));
    consoleLog.length = 0;
    await load({body: '<base href="https://example.invalid/">'});
    expect(warnings(consoleLog)).toEqual(['feedback: "panelSrc" is not valid; the default is used']);
    await page.locator('#trigger').click();
    await load({body: '<base href="https://example.invalid/">', attrs: {endpoint, panelSrc: '/feedbackPanel.js'}});
    await sendReport(page);
    await receiver.reports(1);
    expect(requests.some(u => u.startsWith('https://example.invalid'))).toBe(false);
});

test('the launcher draws one button that opens the panel, and takes its label', async ({page, load}) => {
    await load({attrs: {launcher: {position: 'bottom-left', label: 'Help us'}}});
    const launcher = page.getByRole('button', {name: 'Help us'});
    await expect(launcher).toBeVisible();
    const box = await launcher.boundingBox();
    expect(box.x).toBeLessThan(40);
    await launcher.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(launcher).toBeFocused();
});

test('locale sets the direction and the words come from labels', async ({page, load}) => {
    await load({attrs: {locale: 'ar', labels: {title: 'ملاحظات'}}});
    await openPanel(page);
    await expect(page.getByRole('dialog', {name: 'ملاحظات'})).toBeVisible();
    expect(await page.locator('[data-feedback-panel]').evaluate(h => h.shadowRoot.querySelector('.root').dir)).toBe('rtl');
});
