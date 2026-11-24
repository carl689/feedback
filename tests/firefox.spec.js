// Firefox: a browser that captures but cannot promise this tab (getSupportedConstraints() has no
// displaySurface). Run by the firefox project only, on the Xvfb display firefoxDisplay.js starts;
// with the permission prompt off, Firefox shares that whole screen at once.
'use strict';
const {test, expect, openPanel, sendReport} = require('./fixtures');

test.skip(!!process.env.FEEDBACK_FIREFOX_SKIP || !process.env.FEEDBACK_FIREFOX_DISPLAY, process.env.FEEDBACK_FIREFOX_SKIP || 'no display for Firefox');

const NOTE = 'This browser shares a whole window or screen, not only this page. Check the preview before you send.';

/** The duration, in seconds, Firefox itself reads from a received file's bytes. */
const durationOf = (page, file) => page.evaluate(async ({base64, type}) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(new Blob([bytes], {type}));
    await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = () => reject(new Error('the file does not load')); });
    return v.duration;
}, file);

test('what Firefox reports: no displaySurface constraint, and a shared screen with no displaySurface setting', async ({page, load}) => {
    await load({init: true});
    const facts = await page.evaluate(async () => {
        const constraint = navigator.mediaDevices.getSupportedConstraints().displaySurface;
        const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        stream.getTracks().forEach(t => t.stop());
        return {constraint: constraint === undefined ? 'absent' : constraint, setting: settings.displaySurface === undefined ? 'absent' : settings.displaySurface, label: track.label};
    });
    test.info().annotations.push({type: 'firefox', description: JSON.stringify(facts)});
    expect(facts.constraint).toBe('absent');
    expect(facts.setting).toBe('absent');
});

test('the capture buttons are shown with the note, and the recording note is the one for a single page', async ({page, load}) => {
    await load({init: true});
    const p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toBeVisible();
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toBeVisible();
    await expect(p.dialog.getByText(NOTE)).toBeVisible();
    // no Navigation API in this Firefox, so no following across pages
    const follows = await page.evaluate(() => typeof window.navigation === 'object' && typeof NavigateEvent === 'function');
    await expect(p.dialog.getByText(follows ? 'The recording follows you from page to page on this site.' : 'A recording stops if this page reloads or you leave it.')).toBeVisible();
});

test('a screenshot and a short recording of the shared screen arrive as real files of their types, the recording with a finite length', async ({page, load, receiver}) => {
    test.setTimeout(60000);
    await load({init: true});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('from Firefox');
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toHaveCount(1, {timeout: 10000});
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible({timeout: 10000});
    await page.waitForTimeout(2500);
    await stop.click();
    await expect(p.dialog.locator('video')).toHaveCount(1, {timeout: 10000});
    await p.send.click();
    await expect(p.done).toBeVisible();
    const [entry] = await receiver.reports(1);
    const {screenshot, video} = entry.files;
    expect(screenshot.type).toBe(entry.report.attachments.screenshot.type);
    const shot = Buffer.from(screenshot.base64, 'base64');
    const isWebp = shot.subarray(0, 4).toString('latin1') === 'RIFF' && shot.subarray(8, 12).toString('latin1') === 'WEBP';
    const isJpeg = shot[0] === 0xff && shot[1] === 0xd8;
    expect(isWebp || isJpeg).toBe(true);
    expect(video.type).toBe('video/webm');
    expect(Buffer.from(video.base64, 'base64').subarray(0, 4).toString('hex')).toBe('1a45dfa3');
    // Firefox reports no surface, so none is claimed
    expect(entry.report.attachments.screenshot.surface).toBeUndefined();
    expect(entry.report.attachments.video.surface).toBeUndefined();
    expect(entry.report.attachments.video.ms).toBeGreaterThanOrEqual(2000);
    const seconds = await durationOf(page, video);
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(1.5);
});

test('anySurface: false hides the buttons and the note', async ({page, load}) => {
    await load({init: `{endpoint: '/receive/x', anySurface: false}`});
    const p = await openPanel(page);
    await expect(p.dialog.getByRole('button', {name: 'Screenshot'})).toHaveCount(0);
    await expect(p.dialog.getByRole('button', {name: 'Record screen'})).toHaveCount(0);
    await expect(p.dialog.getByText(NOTE)).toBeHidden();
});

test('the panel opens, sends and closes by keyboard', async ({page, load, receiver}) => {
    await load({init: true});
    await page.locator('#trigger').focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
    await expect(dialog).toBeVisible();
    await page.keyboard.press('ArrowRight'); // picks the next type: Feature request
    await page.keyboard.press('Tab');
    await page.keyboard.type('typed in Firefox');
    const active = () => page.locator('[data-feedback-panel]').evaluate(h => h.shadowRoot.activeElement && h.shadowRoot.activeElement.textContent);
    for (let i = 0; i < 12 && (await active()) !== 'Send'; i++) await page.keyboard.press('Tab');
    expect(await active()).toBe('Send');
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.done')).toBeVisible();
    const [entry] = await receiver.reports(1);
    expect([entry.report.type, entry.report.message]).toEqual(['feature', 'typed in Firefox']);
    await expect.poll(active).toBe('Close');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
});

test('a link clicked while recording goes to the next page and the recording ends with it, with no error', async ({page, base, inbox}) => {
    await page.addInitScript(box => { try { sessionStorage.setItem('feedback.test', JSON.stringify({inbox: box})); } catch {} }, inbox);
    await page.goto(`${base}/site/walk-a.html`);
    await page.locator('#trigger').click();
    const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
    await dialog.getByRole('radio', {name: 'Bug'}).click();
    await expect(dialog.getByText('A recording stops if this page reloads or you leave it.')).toBeVisible();
    await dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible({timeout: 10000});
    await page.waitForTimeout(800);
    await page.locator('#toB').click();
    await page.waitForURL(/walk-b\.html$/);
    await expect(page.locator('h1')).toHaveText('Page B');
    // the new page has no recording: its widget is fresh
    await expect(page.locator('[data-feedback-panel]')).toHaveCount(0);
});

test('Firefox\'s own WebM: its header shape, and the length the widget writes into it', async ({page, load}) => {
    test.setTimeout(45000);
    await load({init: true});
    await openPanel(page); // loads the panel, and with it the hub's webmWithDuration
    const out = await page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
        const recorder = new MediaRecorder(stream, {mimeType: 'video/webm'});
        const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        const started = performance.now();
        recorder.start(500);
        await new Promise(r => setTimeout(r, 1800));
        await new Promise(r => { recorder.onstop = r; recorder.stop(); });
        const ms = Math.round(performance.now() - started);
        stream.getTracks().forEach(t => t.stop());
        const raw = new Blob(chunks, {type: 'video/webm'});
        const head = new Uint8Array(await raw.slice(0, 64).arrayBuffer());
        const duration = async blob => {
            const v = document.createElement('video');
            v.muted = true;
            v.src = URL.createObjectURL(blob);
            await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = reject; });
            return v.duration;
        };
        const fixed = await window[Symbol.for('feedback.stub')].webmWithDuration(raw, ms);
        const same = async (bytes) => {
            const back = new Uint8Array(await (await window[Symbol.for('feedback.stub')].webmWithDuration(new Blob([bytes], {type: 'video/webm'}), 1234)).arrayBuffer());
            return back.length === bytes.length && back.every((b, i) => b === bytes[i]);
        };
        return {
            head: [...head].map(b => b.toString(16).padStart(2, '0')).join(' '),
            rawDuration: String(await duration(raw)), fixedDuration: await duration(fixed), ms,
            changed: fixed !== raw, grewBy: fixed.size - raw.size,
            oddShapeUntouched: await same(Uint8Array.from({length: 4000}, (_, i) => (i * 7919 + 13) % 256))
        };
    });
    test.info().annotations.push({type: 'firefox webm', description: JSON.stringify(out)});
    // libwebm's header: an EBML header, an unsized Segment, a SeekHead, then Info with a Duration of 0
    expect(out.head).toMatch(/^1a 45 df a3 .* 18 53 80 67 01 ff ff ff ff ff ff ff 11 4d 9b 74/);
    expect(out.changed).toBe(true);
    expect(out.grewBy).toBe(0); // the Duration overwritten in place, nothing added
    expect(out.fixedDuration * 1000).toBeCloseTo(out.ms, -2);
    expect(out.oddShapeUntouched).toBe(true);
});
