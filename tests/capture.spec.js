// Screen capture: this tab only, a screenshot and a recording sent as files of the right type.
// Chrome runs with --use-fake-ui-for-media-stream and --auto-accept-this-tab-capture (the config).
'use strict';
const {test, expect, openPanel} = require('./fixtures');

const bytes = file => Buffer.from(file.base64, 'base64');

/** Replaces getDisplayMedia with a canvas stream that reports the given displaySurface (null: none). */
async function fakeCapture(page, surface) {
    await page.addInitScript(surface => {
        window.__stopped = 0;
        navigator.mediaDevices.getDisplayMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 48;
            canvas.getContext('2d').fillRect(0, 0, 64, 48);
            const stream = canvas.captureStream(5);
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
    }, surface);
}

test('a screenshot and a three-second recording arrive as files of the right type', async ({page, load, receiver}) => {
    await load({attrs: {video: {frameRate: 5, maxWidth: 1280}}});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('with attachments');

    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img', {name: 'Screenshot of this tab'})).toBeVisible();
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeHidden();

    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible();
    // focus goes back to the page, so typing carries on there; the pill says it is recording
    await expect(page.locator('#trigger')).toBeFocused();
    await expect(page.locator('[data-feedback-panel]').getByRole('status').filter({hasText: 'Recording'})).toHaveCount(1);
    await expect(p.dialog).toBeHidden();
    await page.waitForTimeout(3000);
    await stop.click();
    const video = p.dialog.locator('video');
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute('src', /^blob:/);
    await expect(video).toHaveAttribute('controls', '');
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toBeHidden();
    await p.send.click();
    await expect(p.done).toBeVisible();

    const [entry] = await receiver.reports(1);
    expect(entry.order).toEqual(['report', 'screenshot', 'video']);
    const shot = entry.files.screenshot;
    expect(shot.filename).toBe('screenshot.webp');
    expect(shot.type).toBe('image/webp');
    const shotBytes = bytes(shot);
    expect(shotBytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(shotBytes.subarray(8, 12).toString('latin1')).toBe('WEBP');

    const rec = entry.files.video;
    expect(rec.filename).toBe('video.webm');
    expect(rec.type).toBe('video/webm');
    expect(bytes(rec).subarray(0, 4).toString('hex')).toBe('1a45dfa3');

    const a = entry.report.attachments;
    // surface: what the browser reported, this tab
    expect(a.screenshot).toEqual({type: 'image/webp', bytes: shot.size, size: [1280, 720], surface: 'browser'});
    expect(a.video).toMatchObject({type: 'video/webm', bytes: rec.size, frameRate: 5, surface: 'browser'});
    expect(a.video.size).toEqual([1280, 720]);
    expect(a.video.ms).toBeGreaterThanOrEqual(2900);
    expect(a.video.ms).toBeLessThan(8000);
});

test('Remove takes an attachment off and its button comes back', async ({page, load, receiver}) => {
    await load();
    const p = await openPanel(page);
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    const img = p.dialog.getByRole('img', {name: 'Screenshot of this tab'});
    await expect(img).toBeVisible();
    const url = await img.getAttribute('src');
    await p.dialog.getByRole('button', {name: 'Remove'}).click();
    await expect(img).toHaveCount(0);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeVisible();
    // the blob URL was revoked
    expect(await page.evaluate(u => fetch(u).then(() => 'open', () => 'revoked'), url)).toBe('revoked');
    await p.type('Bug').click();
    await p.message.fill('x');
    await p.send.click();
    const [entry] = await receiver.reports(1);
    expect(entry.files).toEqual({});
});

test('a recording stops by itself at maxSeconds and says so', async ({page, load}) => {
    await load({attrs: {video: {maxSeconds: 2}}});
    const p = await openPanel(page);
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible();
    await expect(p.dialog.locator('video')).toBeVisible({timeout: 8000});
    await expect(p.dialog.getByText('The recording stopped at its time limit.')).toBeVisible();
});

test('Escape while recording does not end or discard the recording, on the page or on Stop', async ({page, load}) => {
    await load();
    const p = await openPanel(page);
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible();
    await page.keyboard.press('Escape');
    await stop.focus();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(p.dialog.locator('video')).toBeVisible();
});

for (const [surface, label] of [['monitor', 'a whole screen'], ['window', 'another window'], [null, 'a stream that does not say']]) {
    test(`${label} is stopped and thrown away: only this tab can be captured`, async ({page, load}) => {
        await fakeCapture(page, surface);
        await load();
        const p = await openPanel(page);
        await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
        await expect(p.dialog.getByText('Only this tab can be captured. Choose this tab when the browser asks.')).toBeVisible();
        await expect(p.dialog.getByRole('img')).toHaveCount(0);
        expect(await page.evaluate(() => window.__stopped)).toBe(1);
        await p.dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(p.dialog).toBeVisible();
        await expect(page.getByRole('button', {name: 'Stop'})).toBeHidden();
        expect(await page.evaluate(() => window.__stopped)).toBe(2);
    });
}

test('the attach buttons are absent without getDisplayMedia and when the settings remove them', async ({page, load}) => {
    await load({attrs: {screenshot: false, video: false}});
    let p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toHaveCount(0);
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toHaveCount(0);

    await page.addInitScript(() => { delete MediaDevices.prototype.getDisplayMedia; });
    await load();
    p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toHaveCount(0);
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toHaveCount(0);
    await expect(p.dialog.getByText('A recording stops')).toBeHidden();
});
