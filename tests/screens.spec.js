// Screenshots of the panel's states for a person to look at; not assertions about layout.
// Runs only when FEEDBACK_SCREENSHOTS names a directory to write them to.
'use strict';
const path = require('path');
const {test, expect, openPanel} = require('./fixtures');

const dir = process.env.FEEDBACK_SCREENSHOTS;
test.skip(!dir, 'set FEEDBACK_SCREENSHOTS to a directory to take the screenshots');

const body = '<section><h2>Orders</h2><table><tr><td>#1001</td><td>Shipped</td></tr><tr><td>#1002</td><td>Open</td></tr></table></section>';
const shot = (page, name) => page.screenshot({path: path.join(dir, name + '.png'), animations: 'disabled'});

async function filled(page, load, options = {}) {
    await load(Object.assign({body}, options));
    await page.evaluate(() => console.error('TypeError: x is undefined'));
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('The Save button on the order page does nothing after I change the weight.');
    return p;
}

test('light', async ({page, load}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await filled(page, load);
    await shot(page, 'light');
    await page.getByRole('button', {name: 'Show exactly what is sent'}).click();
    await shot(page, 'light-preview');
});

test('dark', async ({page, load}) => {
    await page.emulateMedia({colorScheme: 'dark'});
    await filled(page, load, {head: '<style>body{background:#111;color:#ddd}</style>'});
    await shot(page, 'dark');
});

test('narrow', async ({page, load}) => {
    await page.setViewportSize({width: 320, height: 640});
    await filled(page, load);
    await shot(page, 'narrow');
});

test('launcher and a themed accent', async ({page, load}) => {
    await load({body, attrs: {launcher: true}, head: '<style>:root{--feedback-accent:#0f766e;--feedback-radius:6px}</style>'});
    await shot(page, 'launcher');
    await page.getByRole('button', {name: 'Feedback'}).click();
    await page.getByRole('radio', {name: 'Message'}).click();
    await shot(page, 'themed');
});

test('a teal accent gets dark text', async ({page, load}) => {
    await load({body, head: '<style>:root{--feedback-accent:#17a2b8}</style>'});
    const p = await openPanel(page);
    await p.type('Feature request').click();
    await p.message.fill('Dark text on a light accent stays readable.');
    await p.message.focus();
    await page.keyboard.press('Shift+Tab');
    await shot(page, 'themed-teal');
});

test('screenshot and recording attached', async ({page, load}) => {
    const p = await filled(page, load);
    await page.getByRole('button', {name: 'Screenshot'}).click();
    await expect(page.locator('[data-feedback-panel] img')).toBeVisible();
    await page.getByRole('button', {name: 'Record screen'}).click();
    await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible();
    await page.waitForTimeout(2200);
    await shot(page, 'recording-pill');
    await page.getByRole('button', {name: 'Stop'}).click();
    await expect(page.locator('[data-feedback-panel] video')).toBeVisible();
    await expect(p.send).toBeEnabled();
    await shot(page, 'attachments');
});

for (const [name, viewport] of [['tall', {width: 1280, height: 600}], ['tall-narrow', {width: 320, height: 568}]]) {
    test(name, async ({page, load, receiver}) => {
        await page.setViewportSize(viewport);
        await receiver.script({status: 413, json: {error: {code: 'tooLarge', message: 'The recording is larger than 12 MB.', field: 'video'}}});
        const p = await filled(page, load);
        await page.getByRole('button', {name: 'Screenshot'}).click();
        await expect(page.locator('[data-feedback-panel] img')).toBeVisible();
        await page.getByRole('button', {name: 'Record screen'}).click();
        await page.waitForTimeout(1500);
        await page.getByRole('button', {name: 'Stop'}).click();
        await expect(page.locator('[data-feedback-panel] video')).toBeVisible();
        await shot(page, name);
        await p.send.click();
        await expect(page.getByRole('button', {name: 'Send without the recording'})).toBeInViewport();
        await shot(page, name + '-refused');
    });
}

test('error state', async ({page, load, receiver}) => {
    await receiver.script({status: 500, text: 'oops'});
    const p = await filled(page, load);
    await p.send.click();
    await expect(p.alert).toContainText('could not be sent');
    await shot(page, 'error');
});

test('too large offer', async ({page, load, receiver}) => {
    await receiver.script({status: 413, json: {error: {code: 'tooLarge', message: 'The screenshot is larger than 5 MB.', field: 'screenshot'}}});
    const p = await filled(page, load);
    await page.getByRole('button', {name: 'Screenshot'}).click();
    await expect(page.locator('[data-feedback-panel] img')).toBeVisible();
    await p.send.click();
    await expect(page.getByRole('button', {name: 'Send without the screenshot'})).toBeVisible();
    await shot(page, 'too-large');
});

test('sent state', async ({page, load, receiver}) => {
    await receiver.script({status: 200, json: {id: '123', message: 'Thanks, we read every one.'}});
    const p = await filled(page, load);
    await p.send.click();
    await expect(p.done).toBeVisible();
    await shot(page, 'sent');
});

test.describe('a recording across pages', () => {
    test.use({viewport: {width: 1280, height: 760}});
    const configure = page => page.addInitScript(() => {
        try { sessionStorage.setItem('feedback.test', JSON.stringify({inbox: 'screens'})); } catch {}
    });
    async function walk(page, base) {
        await configure(page);
        await page.goto(`${base}/site/walk-a.html`);
        await page.locator('#trigger').click();
        const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
        await dialog.getByRole('radio', {name: 'Bug'}).click();
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('Page C shows a broken image after I come from page B.');
        await dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(page.locator('[data-feedback-panel] .pill button')).toBeVisible();
        return dialog;
    }
    const framedOn = (page, file) => page.waitForFunction(f => location.href.endsWith(f) && document.title !== 'Page A', file);

    test('the pill over a framed page, and the panel over the frame with the pages', async ({page, base}) => {
        const dialog = await walk(page, base);
        await page.locator('#toB').click();
        await framedOn(page, 'walk-b.html');
        const frame = page.frames().find(f => f.name().startsWith('feedback-keep-'));
        await frame.locator('#toC').click();
        await framedOn(page, 'walk-c.html');
        await page.waitForTimeout(1500);
        await shot(page, 'follow-pill-framed');
        await page.locator('[data-feedback-panel] .pill button').click();
        await expect(dialog.locator('video')).toBeVisible();
        await dialog.getByRole('button', {name: 'Show exactly what is sent'}).click();
        await dialog.locator('pre').evaluate(pre => {
            pre.scrollIntoView({block: 'end'});
            const line = parseFloat(getComputedStyle(pre).lineHeight);
            const before = pre.textContent.slice(0, pre.textContent.indexOf('"pages"')).split('\n').length - 1;
            pre.scrollTop = before * line;
        });
        await shot(page, 'follow-panel-pages');
    });

    test('the notice when the next page is on another site', async ({page, base}) => {
        const dialog = await walk(page, base);
        await page.locator('#toB').click();
        await framedOn(page, 'walk-b.html');
        await page.waitForTimeout(1200);
        const frame = page.frames().find(f => f.name().startsWith('feedback-keep-'));
        await frame.locator('#other').click();
        await expect(dialog.getByText('The recording stopped because the next page is on another site.')).toBeVisible();
        await shot(page, 'follow-left-site');
    });
});
