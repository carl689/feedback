// Text on the accent stays readable whatever accent the host sets, and the focus ring stays visible.
'use strict';
const {test, expect, openPanel} = require('./fixtures');

const accentPage = vars => ({head: `<style>:root{${vars}}</style>`, attrs: {launcher: true}});

/** The Send button's text and background colors and their contrast ratio. */
async function sendColors(page) {
    return page.locator('[data-feedback-panel]').evaluate(h => {
        const rgb = c => {
            const x = document.createElement('canvas').getContext('2d');
            x.fillStyle = c;
            x.fillRect(0, 0, 1, 1);
            return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const lum = c => {
            const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const s = getComputedStyle(h.shadowRoot.querySelector('.btn.primary'));
        const [a, b] = [lum(s.color), lum(s.backgroundColor)].sort((m, n) => n - m);
        return {color: s.color, background: s.backgroundColor, ratio: (a + 0.05) / (b + 0.05)};
    });
}
async function ready(page) {
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('x');
    return p;
}

for (const scheme of ['light', 'dark']) {
    test(`a teal accent gets dark text on Send and the picked type (${scheme})`, async ({page, load}) => {
        await page.emulateMedia({colorScheme: scheme});
        await load(accentPage('--feedback-accent: #17a2b8'));
        const p = await ready(page);
        const send = await sendColors(page);
        expect(send.background).toBe('rgb(23, 162, 184)');
        expect(send.color).toBe('rgb(17, 17, 17)');
        expect(send.ratio).toBeGreaterThanOrEqual(4.5);
        expect(await p.type('Bug').evaluate(b => getComputedStyle(b).color)).toBe('rgb(17, 17, 17)');
    });
}

test('the default blue keeps white text', async ({page, load}) => {
    await load(accentPage('--feedback-accent: #2563eb'));
    await ready(page);
    const send = await sendColors(page);
    expect(send.color).toBe('rgb(255, 255, 255)');
    expect(send.ratio).toBeGreaterThanOrEqual(4.5);
});

test('a --feedback-accent-text set by the host wins, on the panel and the launcher', async ({page, load}) => {
    await load(accentPage('--feedback-accent: #17a2b8; --feedback-accent-text: #000080'));
    expect(await page.getByRole('button', {name: 'Feedback'}).evaluate(b => getComputedStyle(b).color)).toBe('rgb(0, 0, 128)');
    await ready(page);
    expect((await sendColors(page)).color).toBe('rgb(0, 0, 128)');
});

test('the launcher falls back to white text without --feedback-accent-text', async ({page, load}) => {
    await load(accentPage('--feedback-accent: #2563eb'));
    expect(await page.getByRole('button', {name: 'Feedback'}).evaluate(b => getComputedStyle(b).color)).toBe('rgb(255, 255, 255)');
});

test('an accent under 3:1 against the surface draws focus rings in the text color', async ({page, load}) => {
    await load(accentPage('--feedback-accent: #fde68a'));
    const p = await ready(page);
    await p.message.focus();
    await page.keyboard.press('Shift+Tab');
    const ring = await p.type('Bug').evaluate(b => getComputedStyle(b).outlineColor);
    expect(ring).toBe('rgb(31, 35, 40)');
    expect((await sendColors(page)).ratio).toBeGreaterThanOrEqual(4.5);
});

test('an accent that holds 3:1 keeps its own focus ring', async ({page, load}) => {
    await load(accentPage('--feedback-accent: #17a2b8'));
    const p = await ready(page);
    await p.message.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await p.type('Bug').evaluate(b => getComputedStyle(b).outlineColor)).toBe('rgb(23, 162, 184)');
});

test('a dark accent on the dark surface draws focus rings in the text color', async ({page, load}) => {
    await page.emulateMedia({colorScheme: 'dark'});
    await load(accentPage('--feedback-accent: #1e3a5f'));
    const p = await ready(page);
    await p.message.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await p.type('Bug').evaluate(b => getComputedStyle(b).outlineColor)).toBe('rgb(236, 236, 238)');
    const send = await sendColors(page);
    expect(send.color).toBe('rgb(255, 255, 255)');
    expect(send.ratio).toBeGreaterThanOrEqual(4.5);
});
