// A browser that captures but cannot promise this tab, stood in for in Chrome: getSupportedConstraints()
// without displaySurface and a canvas stream reporting the surface a picker would have given. The
// real one is Firefox (firefox.spec.js); here the same rule is proven where Chrome's own path is
// known, so the strict path is shown untouched beside it.
'use strict';
const fs = require('fs');
const path = require('path');
const {test, expect, openPanel} = require('./fixtures');

const NOTE = 'This browser shares a whole window or screen, not only this page. Check the preview before you send.';

/** No displaySurface constraint, and a getDisplayMedia whose stream reports surface (null: none) at width x height. */
async function wideCapture(page, surface, width = 640, height = 400) {
    await page.addInitScript(([surface, width, height]) => {
        const supported = MediaDevices.prototype.getSupportedConstraints;
        MediaDevices.prototype.getSupportedConstraints = function () {
            const c = supported.call(this);
            delete c.displaySurface;
            return c;
        };
        window.__asked = [];
        window.__stopped = 0;
        MediaDevices.prototype.getDisplayMedia = async function (options) {
            window.__asked.push(JSON.parse(JSON.stringify(options)));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const g = canvas.getContext('2d');
            let i = 0;
            setInterval(() => { g.fillStyle = i++ % 2 ? '#c00' : '#00c'; g.fillRect(0, 0, width, height); }, 50);
            const stream = canvas.captureStream(10);
            const track = stream.getVideoTracks()[0];
            const settings = track.getSettings.bind(track);
            track.getSettings = () => {
                const s = settings();
                if (surface === null) delete s.displaySurface;
                else s.displaySurface = surface;
                return s;
            };
            const stop = track.stop.bind(track);
            track.stop = () => { window.__stopped++; stop(); };
            return stream;
        };
    }, [surface, width, height]);
}

test('where this tab can be captured nothing changed: no note, and the browser is asked for this tab', async ({page, load}) => {
    await load({init: true});
    const p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeVisible();
    await expect(p.dialog.getByText(NOTE)).toBeHidden();
});

test('without a tab surface the buttons and the note show, and a whole screen is taken and labelled monitor', async ({page, load, receiver}) => {
    await wideCapture(page, 'monitor');
    await load({init: true});
    const p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeVisible();
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toBeVisible();
    await expect(p.dialog.getByText(NOTE)).toBeVisible();
    await p.type('Bug').click();
    await p.message.fill('a whole screen');
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toHaveCount(1);
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible();
    await page.waitForTimeout(1500);
    await stop.click();
    await expect(p.dialog.locator('video')).toHaveCount(1);
    // with both attached, no button is left, and the note goes with them
    await expect(p.dialog.getByText(NOTE)).toBeHidden();
    await p.send.click();
    await expect(p.done).toBeVisible();
    const [entry] = await receiver.reports(1);
    expect(entry.report.attachments.screenshot.surface).toBe('monitor');
    expect(entry.report.attachments.video.surface).toBe('monitor');
    expect(Object.keys(entry.files).sort()).toEqual(['screenshot', 'video']);
    // asked with no tab-only hints, and every track stopped
    const asked = await page.evaluate(() => window.__asked);
    expect(asked[0]).toEqual({video: true, audio: false});
    expect(asked[1]).toEqual({video: {frameRate: {ideal: 5, max: 5}, width: {max: 1280}}, audio: false});
    expect(await page.evaluate(() => window.__stopped)).toBeGreaterThanOrEqual(2);
});

test('a stream that names no surface is taken with no surface claimed', async ({page, load, receiver}) => {
    await wideCapture(page, null);
    await load({init: true});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('no surface');
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toHaveCount(1);
    await p.send.click();
    await expect(p.done).toBeVisible();
    const [entry] = await receiver.reports(1);
    expect(entry.report.attachments.screenshot).not.toHaveProperty('surface');
});

for (const [how, options] of [['from init()', {init: `{endpoint: '/receive/x', anySurface: false}`}], ['from data-any-surface', {attrs: {anySurface: false}}]]) {
    test(`anySurface: false ${how} hides the buttons where this tab cannot be captured`, async ({page, load}) => {
        await wideCapture(page, 'monitor');
        await load(options);
        const p = await openPanel(page);
        await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toHaveCount(0);
        await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toHaveCount(0);
        await expect(p.dialog.getByText(NOTE)).toBeHidden();
    });
}

test('anySurface that is not a boolean is one warning and the default', async ({page, load, consoleLog}) => {
    await wideCapture(page, 'window');
    await load({init: `{endpoint: '/receive/x', anySurface: 'no'}`});
    const p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeVisible();
    expect(consoleLog.filter(m => m.text.includes('"anySurface" must be true or false; the default is used'))).toHaveLength(1);
});

test('a screen wider than 3,840 pixels is scaled down to fit before it is attached', async ({page, load, receiver}) => {
    await wideCapture(page, 'monitor', 7680, 2160);
    await load({init: true});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('two 4K screens');
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toHaveCount(1);
    await p.send.click();
    await expect(p.done).toBeVisible();
    const [entry] = await receiver.reports(1);
    expect(entry.report.attachments.screenshot.size).toEqual([3840, 1080]);
    expect(entry.files.screenshot.size).toBeLessThanOrEqual(4 << 20);
});

test('the capability is asked at each press: a browser that starts reporting a tab surface takes the strict path', async ({page, load}) => {
    await wideCapture(page, 'monitor');
    await load({init: true});
    const p = await openPanel(page);
    await expect(p.dialog.getByText(NOTE)).toBeVisible();
    // the browser now says it can capture a tab, as one will after an update
    await page.evaluate(() => {
        const supported = MediaDevices.prototype.getSupportedConstraints;
        MediaDevices.prototype.getSupportedConstraints = function () { return Object.assign(supported.call(this), {displaySurface: true}); };
    });
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByText('Only this tab can be captured. Choose this tab when the browser asks.')).toBeVisible();
    await expect(p.dialog.getByRole('img')).toHaveCount(0);
    await expect(p.dialog.getByText(NOTE)).toBeHidden();
    expect((await page.evaluate(() => window.__asked))[0]).toMatchObject({video: {displaySurface: 'browser'}, preferCurrentTab: true});
});

test('a Firefox WebM, whose Duration is 0, gets its length written in place: Chrome then reads it', async ({page, load}) => {
    await load();
    await page.locator('#trigger').click(); // loads the panel and its webmWithDuration
    await expect(page.locator('[data-feedback-panel]').getByRole('dialog')).toBeVisible();
    const file = fs.readFileSync(path.join(__dirname, 'pages', 'firefox-recording.webm')).toString('base64');
    const out = await page.evaluate(async b64 => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const raw = new Blob([bytes], {type: 'video/webm'});
        const duration = async blob => {
            const v = document.createElement('video');
            v.muted = true;
            v.src = URL.createObjectURL(blob);
            await new Promise(r => v.addEventListener('loadedmetadata', r, {once: true}));
            return v.duration;
        };
        const fixed = await window[Symbol.for('feedback.stub')].webmWithDuration(raw, 1234);
        const after = new Uint8Array(await fixed.arrayBuffer());
        const changed = [];
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== after[i]) changed.push(i);
        return {raw: String(await duration(raw)), fixed: await duration(fixed), sameLength: after.length === bytes.length, changed};
    }, file);
    expect(out.raw).toBe('Infinity');
    expect(out.fixed).toBeCloseTo(1.234, 2);
    expect(out.sameLength).toBe(true);
    // only the Duration's eight bytes, at 0x59 in this file
    expect(out.changed.every(i => i >= 0x59 && i < 0x61)).toBe(true);
});
