// A panel taller than the window: the title and the Cancel/Send row stay in view, the middle
// scrolls, and a refusal is scrolled into view when it arrives.
'use strict';
const {test, expect, openPanel} = require('./fixtures');

for (const viewport of [{width: 1280, height: 600}, {width: 320, height: 568}]) {
    test(`at ${viewport.width}x${viewport.height} with both attachments Send stays in view and a refusal is shown`, async ({page, load, receiver}) => {
        await page.setViewportSize(viewport);
        await receiver.script({status: 413, json: {error: {code: 'tooLarge', message: 'The recording is larger than 12 MB.', field: 'video'}}});
        await load();
        await page.evaluate(() => { for (let i = 0; i < 5; i++) console.error('expected-in-test ' + i); });
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('A long report.\n'.repeat(12));
        await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
        await expect(p.dialog.getByRole('img')).toHaveCount(1);
        await p.dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible();
        await page.waitForTimeout(1500);
        await page.getByRole('button', {name: 'Stop'}).click();
        await expect(p.dialog.locator('video')).toHaveCount(1);
        await p.showPreview.click();

        // the card is capped at the window, its middle scrolls, the title and actions are whole
        const box = await p.dialog.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
        const scrolls = await page.locator('[data-feedback-panel]').evaluate(h => {
            const s = h.shadowRoot.querySelector('form .scroll');
            return s.scrollHeight > s.clientHeight;
        });
        expect(scrolls).toBe(true);
        await expect(p.dialog.getByRole('heading', {name: 'Send feedback'})).toBeInViewport({ratio: 1});
        await expect(p.cancel).toBeInViewport({ratio: 1});
        await expect(p.send).toBeInViewport({ratio: 1});
        expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);

        // focus moving to a control in the middle scrolls it into view
        await p.message.focus();
        await expect(p.message).toBeInViewport();
        await page.keyboard.press('Shift+Tab');
        await expect(p.type('Bug')).toBeFocused();
        await expect(p.type('Bug')).toBeInViewport({ratio: 1});

        await p.send.click({noWaitAfter: true});
        await expect(p.alert).toContainText('The recording is larger than 12 MB.');
        await expect(p.alert.getByText('The recording is larger than 12 MB.')).toBeInViewport({ratio: 1});
        await expect(p.alert.getByRole('button', {name: 'Send without the recording'})).toBeInViewport({ratio: 1});
        await expect(p.send).toBeInViewport({ratio: 1});
        expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
    });
}
