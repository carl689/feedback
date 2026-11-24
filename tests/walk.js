// Helpers for the tests of a recording across pages, on the test site in pages/site/.
'use strict';
const {expect} = require('./fixtures');

/** Each test's settings, read by pages/site/site.js on every page, the framed ones included. */
async function configure(page, inbox, init = {}) {
    await page.addInitScript(([box, settings]) => {
        try { sessionStorage.setItem('feedback.test', JSON.stringify({inbox: box, init: settings})); } catch {} // not on an error page
    }, [inbox, init]);
}
const dialogOf = page => page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
const stopButton = page => page.locator('[data-feedback-panel] .pill button');
const keepFrame = page => page.frames().find(f => f.name().startsWith('feedback-keep-')) || null;
const recording = page => stopButton(page).isVisible();

/** Opens the panel from #trigger, picks Bug, types, presses Record and waits for the pill. */
async function begin(page, base, file = 'walk-a.html') {
    if (file) await page.goto(`${base}/site/${file}`);
    await page.locator('#trigger').click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('radio', {name: 'Bug'}).click();
    await dialog.getByRole('textbox', {name: 'Your message'}).fill('a walk across pages');
    await dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(stopButton(page)).toBeVisible();
    return dialog;
}
/** Waits until the frame is shown on an address matching re, loaded, with the window's address following it. */
async function framed(page, re) {
    await page.waitForFunction(source => {
        const re = new RegExp(source);
        const f = document.querySelector('iframe[data-feedback-frame]');
        if (!f || getComputedStyle(f.parentElement).visibility !== 'visible' || getComputedStyle(f).visibility !== 'visible') return false;
        try { return re.test(f.contentWindow.location.href) && f.contentDocument.readyState === 'complete' && re.test(location.href); } catch { return false; }
    }, re.source, {timeout: 10000});
}
/** Waits until the page the recording began on is showing again (no frame shown) at an address matching re. */
async function unframed(page, re) {
    await page.waitForFunction(source => {
        const f = document.querySelector('iframe[data-feedback-frame]');
        const shown = f && getComputedStyle(f.parentElement).visibility === 'visible';
        return !shown && new RegExp(source).test(location.href);
    }, re.source, {timeout: 10000});
}
/** Presses Stop and waits for the recording in the panel. */
async function stop(page) {
    await stopButton(page).click();
    const dialog = dialogOf(page);
    await expect(dialog.locator('video')).toBeVisible();
    return dialog;
}
/** Begin on A, follow a link to B and record a moment there; then Stop and Send (or Cancel), and close the panel. */
async function lazyOn(page, base, {send = true, to = 'walk-b.html', fresh = true} = {}) {
    await begin(page, base, fresh ? 'walk-a.html' : null);
    await page.locator('#toB').click();
    await framed(page, /walk-b\.html$/);
    if (to !== 'walk-b.html') {
        await keepFrame(page).locator(`a[href="${to}"]`).first().click();
        await framed(page, new RegExp(to.replace('.', '\\.') + '$'));
    }
    await page.waitForTimeout(800);
    const dialog = await stop(page);
    if (send) {
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        await dialog.getByRole('button', {name: 'Close'}).click();
    } else await dialog.getByRole('button', {name: 'Cancel'}).click();
    await expect(dialog).toBeHidden();
    return dialog;
}
const facts = page => page.evaluate(() => {
    const f = document.querySelector('iframe[data-feedback-frame]');
    return {url: location.href, title: document.title, historyLength: history.length,
        frames: document.querySelectorAll('iframe[data-feedback-frame]').length,
        shown: !!f && getComputedStyle(f.parentElement).visibility === 'visible',
        blank: !!f && getComputedStyle(f).visibility === 'hidden'};
});

/** The colour painted at a point of the window, read from a real screenshot (hit-testing skips inert content). */
async function colourAt(page, x, y) {
    const png = (await page.screenshot()).toString('base64');
    return page.evaluate(async ([data, px, py]) => {
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], {type: 'image/png'}));
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        const scale = image.width / innerWidth;
        return [...ctx.getImageData(Math.round(px * scale), Math.round(py * scale), 1, 1).data].slice(0, 3);
    }, [png, x, y]);
}

module.exports = {colourAt, configure, dialogOf, stopButton, keepFrame, recording, begin, framed, unframed, stop, lazyOn, facts};
