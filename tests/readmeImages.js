// Takes the pictures the README and docs show, of the real widget on examples/demo.html, into docs/images/.
//   cd tests && npm install && node readmeImages.js
// It starts examples/demo.js on a free port and drives the installed Google Chrome (FEEDBACK_TEST_CHANNEL=
// picks another channel, empty for Playwright's own Chromium). Not a test: nothing here asserts.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const {chromium} = require('@playwright/test');

const OUT = path.join(__dirname, '..', 'docs', 'images');
const MESSAGE = 'Order #1047 has said Packing since yesterday, but its label was printed this morning.';

async function main() {
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-images-'));
    const demo = spawn(process.execPath, [path.join(__dirname, '..', 'examples', 'demo.js')],
        {env: Object.assign({}, process.env, {FEEDBACK_DIR: store, PORT: '0'}), stdio: ['ignore', 'pipe', 'inherit']});
    const base = await new Promise(resolve => demo.stdout.once('data', line => resolve(/http:\/\/[\d.:]+/.exec(line)[0])));
    const browser = await chromium.launch({
        channel: 'FEEDBACK_TEST_CHANNEL' in process.env ? process.env.FEEDBACK_TEST_CHANNEL || undefined : 'chrome',
        args: ['--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture']
    });
    fs.mkdirSync(OUT, {recursive: true});

    /** A page of the demo with the panel open, Bug picked and a message typed. */
    async function open({viewport = {width: 1200, height: 720}, colorScheme = 'light', scale = 1, at = '/'} = {}) {
        const context = await browser.newContext({viewport, colorScheme, deviceScaleFactor: scale, hasTouch: viewport.width < 500});
        const page = await context.newPage();
        await page.goto(base + at);
        await page.evaluate(() => console.error("TypeError: Cannot read properties of undefined (reading 'status')"));
        await page.getByRole('button', {name: 'Feedback'}).click();
        const dialog = page.getByRole('dialog', {name: 'Send feedback'});
        await dialog.getByRole('radio', {name: 'Bug'}).click();
        await dialog.getByRole('textbox', {name: 'Your message'}).fill(MESSAGE);
        return {page, dialog, context};
    }
    const shot = (page, name, clip) => page.screenshot({path: path.join(OUT, name + '.png'), animations: 'disabled', clip});
    /** The dialog's box with a margin of the page around it, kept inside the viewport. */
    async function around(page, dialog, margin = 24) {
        const box = await dialog.boundingBox();
        const view = page.viewportSize();
        const x = Math.max(0, box.x - margin), y = Math.max(0, box.y - margin);
        return {x, y, width: Math.min(view.width, box.x + box.width + margin) - x, height: Math.min(view.height, box.y + box.height + margin) - y};
    }

    // the hero: the panel over the page, light
    let s = await open();
    await shot(s.page, 'panel');
    await s.context.close();
    s = await open({viewport: {width: 1200, height: 860}});
    // the exact report, expanded
    await s.dialog.getByRole('button', {name: 'Show exactly what is sent'}).click();
    await shot(s.page, 'preview', await around(s.page, s.dialog));
    await s.context.close();

    // a screenshot and a recording attached, and the pill while recording
    s = await open({viewport: {width: 1200, height: 860}});
    await s.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await s.dialog.locator('img').waitFor();
    await s.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = s.page.getByRole('button', {name: 'Stop'});
    await stop.waitFor();
    await s.page.mouse.move(400, 300);
    await s.page.waitForTimeout(4200);
    await s.page.setViewportSize({width: 1200, height: 720});
    await s.page.waitForTimeout(300);
    await shot(s.page, 'recording-pill', {x: 640, y: 440, width: 560, height: 280});
    await s.page.setViewportSize({width: 1200, height: 860});
    await stop.click();
    await s.dialog.locator('video').waitFor();
    await s.dialog.locator('video').evaluate(video => new Promise(done => video.readyState >= 2 ? done() : video.addEventListener('loadeddata', done)));
    await s.page.waitForTimeout(1500);
    await shot(s.page, 'attachments', await around(s.page, s.dialog));
    await s.context.close();

    // dark
    s = await open({colorScheme: 'dark', viewport: {width: 1000, height: 640}});
    await shot(s.page, 'dark');
    await s.context.close();

    // a phone: the bottom sheet
    s = await open({viewport: {width: 390, height: 760}, scale: 2});
    await shot(s.page, 'phone');
    await s.context.close();

    await browser.close();
    demo.kill();
    fs.rmSync(store, {recursive: true, force: true});
}

main().catch(error => { console.error(error); process.exit(1); });
