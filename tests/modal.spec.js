// Opening the panel over a host page's own modal: a focus trap written the way Bootstrap 5 writes
// its own, added before the stub loads or after, and a native <dialog> opened with showModal().
'use strict';
const {test, expect, panel} = require('./fixtures');

// Bootstrap's trap: focus landing outside the modal is sent back to the modal. Escape on the
// document closes the modal, as a host's own Escape handler would.
const TRAP = `
    window.__trapped = 0;
    const modal = document.getElementById('modal');
    document.addEventListener('focusin', e => {
        if (e.target !== document && !modal.contains(e.target)) { window.__trapped++; modal.focus(); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') modal.hidden = true; });`;
const MODAL = `<button type="button" id="outside">Outside the modal</button>
<div id="modal" tabindex="-1" role="dialog" aria-modal="true" aria-label="Edit shipping">
    <h2>Edit shipping</h2>
    <input id="weight" aria-label="Weight">
    <button type="button" id="inModal" data-feedback>Feedback</button>
</div>`;

const variants = {
    'a trap added before the stub loads': {body: `${MODAL}<script>${TRAP}</script>`},
    'a trap added after the page loaded': {body: `${MODAL}<script>window.addEventListener('load', () => {${TRAP}});</script>`}
};

const insidePanel = page => page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-feedback-panel'));

for (const [name, options] of Object.entries(variants)) {
    test(`over ${name}: the panel takes focus, keeps it, and gives it back to the modal`, async ({page, load, receiver}) => {
        await load(options);
        await page.locator('#weight').focus();
        await page.locator('#inModal').click();
        const p = panel(page);
        await expect(p.dialog).toBeVisible();
        expect(await insidePanel(page)).toBe(true);

        await p.type('Bug').click();
        await p.message.fill('typed over a modal');
        await expect(p.message).toHaveValue('typed over a modal');
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            expect(await insidePanel(page)).toBe(true);
        }

        await page.keyboard.press('Escape');
        await expect(p.dialog).toBeHidden();
        await expect(page.locator('#modal')).toBeVisible(); // the host's modal was not closed
        await expect(page.locator('#inModal')).toBeFocused();

        // the host's trap works again
        await page.locator('#outside').focus();
        expect(await page.evaluate(() => document.activeElement.id)).toBe('modal');

        await page.locator('#inModal').click();
        await expect(p.dialog).toBeVisible();
        await p.send.click();
        await expect(p.done).toBeVisible();
        expect((await receiver.reports(1))[0].report.message).toBe('typed over a modal');
    });
}

test('a trap added while the panel is open cannot pull focus out of it', async ({page, load}) => {
    await load({body: MODAL});
    await page.locator('#inModal').click();
    const p = panel(page);
    await expect(p.dialog).toBeVisible();
    await page.evaluate(new Function(TRAP));
    await p.message.click();
    await page.keyboard.type('still here');
    await expect(p.message).toHaveValue('still here');
    expect(await page.evaluate(() => window.__trapped)).toBe(0);
});

test('a trap that runs before the widget\'s own (on window, capturing) wins without recursion', async ({page, load}) => {
    await load({body: `${MODAL}<script>
        const modal = document.getElementById('modal');
        window.addEventListener('focusin', e => { if (!modal.contains(e.target)) modal.focus(); }, true);
    </script>`});
    await page.locator('#inModal').click();
    await expect(panel(page).dialog).toBeVisible();
    await page.keyboard.press('Tab');
    // no stack overflow (the fixture fails on any page error); the host's earlier trap keeps focus
    expect(await page.evaluate(() => document.activeElement.id)).toBe('modal');
});

test('the recording pill over a trapped modal: Stop works with the keyboard and the mouse', async ({page, load}) => {
    await load(variants['a trap added before the stub loads']);
    await page.locator('#inModal').click();
    const p = panel(page);
    await expect(p.dialog).toBeVisible();
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible();
    // focus is back in the modal; the pill is the next Tab stop, which the modal's trap lets it keep
    await expect(page.locator('#inModal')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(stop).toBeFocused();
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter');
    await expect(p.dialog.locator('video')).toBeVisible();
    expect(await insidePanel(page)).toBe(true);

    await p.dialog.getByRole('button', {name: 'Remove'}).click();
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(stop).toBeVisible();
    await page.waitForTimeout(1200);
    await stop.click();
    await expect(p.dialog.locator('video')).toBeVisible();
});

// A native modal <dialog> makes the rest of the document inert; the widget goes into a modal
// <dialog> of its own over it, and puts the recording pill inside the host's dialog.
const NATIVE = `<dialog id="native" aria-label="Edit shipping">
    <h2>Edit shipping</h2>
    <input id="weight" aria-label="Weight">
    <button type="button" id="inDialog" data-feedback>Feedback</button>
</dialog>
<script>window.addEventListener('load', () => document.getElementById('native').showModal());</script>`;

test('over a native modal <dialog> the panel can be used, and Escape closes only the panel', async ({page, load, receiver}) => {
    await load({body: NATIVE});
    await expect(page.locator('#native')).toHaveJSProperty('open', true);
    await page.locator('#inDialog').click();
    const p = panel(page);
    await expect(p.dialog).toBeVisible();
    expect(await insidePanel(page)).toBe(true);
    await p.type('Feature request').click();
    await expect(p.type('Feature request')).toHaveAttribute('aria-checked', 'true');
    await p.message.fill('over a native dialog');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect(page.locator('#native')).toHaveJSProperty('open', true);
    await expect(page.locator('#inDialog')).toBeFocused();

    await page.locator('#inDialog').click();
    await expect(p.message).toHaveValue('over a native dialog');
    await p.send.click();
    await expect(p.done).toBeVisible();
    expect((await receiver.reports(1))[0].report.type).toBe('feature');
    await p.close.click();
    await expect(page.locator('#inDialog')).toBeFocused();
    expect(await page.locator('[data-feedback-layer]').evaluate(d => d.open)).toBe(false);
});

test('over a native modal <dialog> the recording pill is usable and Stop opens the panel', async ({page, load}) => {
    await load({body: NATIVE});
    await page.locator('#inDialog').click();
    const p = panel(page);
    await expect(p.dialog).toBeVisible();
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    const stop = page.getByRole('button', {name: 'Stop'});
    await expect(stop).toBeVisible();
    // the page under the pill stays usable while recording
    await page.locator('#weight').fill('4.2');
    await expect(page.locator('#weight')).toHaveValue('4.2');
    await page.waitForTimeout(1000);
    await stop.click();
    await expect(p.dialog.locator('video')).toBeVisible();
    expect(await insidePanel(page)).toBe(true);
});
