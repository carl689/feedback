// Keyboard only, and the dialog's accessibility: name, modal, focus in and back, the radio group,
// the Tab trap, Escape, contrast and reduced motion.
'use strict';
const {test, expect, openPanel, panel} = require('./fixtures');

const insidePanel = page => page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-feedback-panel'));
const focusedName = page => page.evaluate(() => {
    const host = document.activeElement;
    const el = host && host.shadowRoot ? host.shadowRoot.activeElement : host;
    return el ? (el.getAttribute('aria-label') || el.textContent || el.tagName).trim() : '';
});

test('keyboard only: open, pick, type, send, and focus goes back to the trigger', async ({page, load, receiver}) => {
    await load();
    await page.keyboard.press('Tab');
    await expect(page.locator('#trigger')).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {name: 'Send feedback'});
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog.getByRole('radio', {name: 'Bug'})).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', {name: 'Feature request'})).toBeFocused();
    await expect(dialog.getByRole('radio', {name: 'Feature request'})).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', {name: 'Bug'})).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByRole('radio', {name: 'Message'})).toHaveAttribute('aria-checked', 'true');

    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('textbox', {name: 'Your message'})).toBeFocused();
    await page.keyboard.type('Typed with the keyboard');
    for (let i = 0; i < 12 && (await focusedName(page)) !== 'Send'; i++) {
        await page.keyboard.press('Tab');
        expect(await insidePanel(page)).toBe(true);
    }
    expect(await focusedName(page)).toBe('Send');
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('button', {name: 'Close'})).toBeFocused();
    await expect(dialog.getByText('Sent, #1')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#trigger')).toBeFocused();
    const r = (await receiver.reports(1))[0].report;
    expect(r).toMatchObject({type: 'message', message: 'Typed with the keyboard'});
});

test('Tab and Shift+Tab never leave the panel', async ({page, load}) => {
    await load({body: '<a href="#after">a link after</a><input aria-label="after">'});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('enable Send');
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Tab');
        expect(await insidePanel(page)).toBe(true);
        seen.add(await focusedName(page));
    }
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press('Shift+Tab');
        expect(await insidePanel(page)).toBe(true);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['Bug', 'TEXTAREA', 'Screenshot', 'Record screen', 'Show exactly what is sent', 'Cancel', 'Send']));
});

test('Escape closes and focus returns to what opened the panel; the draft stays', async ({page, load}) => {
    await load();
    const p = await openPanel(page);
    await p.message.fill('half written');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect(page.locator('#trigger')).toBeFocused();
    await page.evaluate(() => feedback.open());
    await expect(p.message).toHaveValue('half written');
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
});

test('a refusal is announced in an alert and the counter is tied to the message box', async ({page, load, receiver}) => {
    await receiver.script({status: 500});
    await load();
    const p = await openPanel(page);
    await expect(p.message).toHaveAttribute('aria-describedby', 'fb-counter');
    await p.type('Bug').click();
    await p.message.fill('x');
    await p.send.click();
    await expect(p.dialog.getByRole('alert')).toHaveText(/could not be sent/);
});

/** Contrast of a piece of the panel against the card it sits on, from the computed colors. */
async function contrasts(page) {
    return page.locator('[data-feedback-panel]').evaluate(host => {
        const root = host.shadowRoot;
        const rgb = c => {
            const probe = document.createElement('canvas').getContext('2d');
            probe.fillStyle = c;
            probe.fillRect(0, 0, 1, 1);
            return [...probe.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const lum = c => {
            const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        const card = getComputedStyle(root.querySelector('.card')).backgroundColor;
        const out = {};
        for (const [name, sel] of [['title', 'h2'], ['label', 'label'], ['sentLine', '.sent-line'], ['note', '.note'], ['link', '.link'], ['cancel', '.actions .btn']]) {
            out[name] = ratio(getComputedStyle(root.querySelector(sel)).color, card);
        }
        const send = getComputedStyle(root.querySelector('.btn.primary'));
        out.send = ratio(send.color, send.backgroundColor);
        const picked = getComputedStyle(root.querySelector('[aria-checked="true"]'));
        out.picked = ratio(picked.color, picked.backgroundColor);
        const alert = root.querySelector('.alert');
        alert.textContent = 'probe';
        out.alert = ratio(getComputedStyle(alert).color, card);
        alert.textContent = '';
        return out;
    });
}

for (const scheme of ['light', 'dark']) {
    test(`every text meets 4.5:1 in the ${scheme} theme`, async ({page, load}) => {
        await page.emulateMedia({colorScheme: scheme});
        await load();
        const p = await openPanel(page);
        await p.type('Bug').click();
        for (const [name, value] of Object.entries(await contrasts(page))) expect(value, name).toBeGreaterThanOrEqual(4.5);
    });
}

test('theme forces a scheme whatever the system prefers', async ({page, load}) => {
    await page.emulateMedia({colorScheme: 'light'});
    await load({attrs: {theme: 'dark'}});
    await openPanel(page);
    const background = await page.locator('[data-feedback-panel]').evaluate(h => getComputedStyle(h.shadowRoot.querySelector('.card')).backgroundColor);
    expect(background).toBe('rgb(28, 28, 31)');
});

test('no animation under prefers-reduced-motion', async ({page, load}) => {
    await page.emulateMedia({reducedMotion: 'reduce'});
    await load();
    await openPanel(page);
    const names = await page.locator('[data-feedback-panel]').evaluate(h => [
        getComputedStyle(h.shadowRoot.querySelector('.card')).animationName,
        getComputedStyle(h.shadowRoot.querySelector('.dot')).animationName
    ]);
    expect(names).toEqual(['none', 'none']);
});

// The trigger as an item of a menu that hides itself on the press, the menu named by its toggle
const MENU = `<div class="menu">
    <button type="button" id="toggle" aria-expanded="false" aria-controls="menu" onclick="document.getElementById('menu').hidden = false">Help</button>
    <ul id="menu" aria-labelledby="toggle" hidden>
        <li><button type="button" id="item" data-feedback onclick="document.getElementById('menu').hidden = true">Send feedback</button></li>
    </ul>
</div>`;

for (const how of ['Cancel', 'Escape']) {
    test(`a trigger hidden with its menu: after ${how} focus goes to the menu's toggle`, async ({page, load}) => {
        await load({body: MENU});
        await page.locator('#toggle').click();
        await page.locator('#item').click();
        const p = panel(page);
        await expect(p.dialog).toBeVisible();
        await expect(page.locator('#item')).toBeHidden();
        if (how === 'Cancel') await p.cancel.click();
        else await page.keyboard.press('Escape');
        await expect(p.dialog).toBeHidden();
        await expect(page.locator('#toggle')).toBeFocused();
    });
}

test('a toggle found by aria-controls when the container has no aria-labelledby', async ({page, load}) => {
    await load({body: MENU.replace(' aria-labelledby="toggle"', '')});
    await page.locator('#toggle').click();
    await page.locator('#item').click();
    await expect(panel(page).dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#toggle')).toBeFocused();
});

test('a trigger removed from the document: no error and focus is on the body', async ({page, load}) => {
    await load({body: '<div id="modal"><button type="button" id="inside" data-feedback onclick="this.remove()">Feedback</button></div>'});
    await page.locator('#inside').click();
    const p = panel(page);
    await expect(p.dialog).toBeVisible();
    await p.cancel.click();
    await expect(p.dialog).toBeHidden();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});
