// No unsafe-inline, no eval: the panel opens, looks right, captures and sends on a page served with
// default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; style-src 'none'.
'use strict';
const {test, expect, openPanel} = require('./fixtures');

test('under a strict CSP the panel opens, captures and sends with no violation', async ({page, base, request, consoleLog}) => {
    await page.addInitScript(() => {
        window.__violations = [];
        document.addEventListener('securitypolicyviolation', e => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const response = await page.goto(`${base}/pages/csp-strict.html`);
    expect(response.headers()['content-security-policy']).toBe("default-src 'none'; script-src 'self'; connect-src 'self'; img-src blob:; media-src blob:; style-src 'none'");

    // the launcher, styled through CSSOM properties
    const launcher = page.getByRole('button', {name: 'Feedback'});
    await expect(launcher).toBeVisible();
    expect(await launcher.evaluate(b => getComputedStyle(b).position)).toBe('fixed');

    const p = await openPanel(page);
    // the adopted stylesheet applied: a white card, fixed in place, with the system font
    const look = await page.locator('[data-feedback-panel]').evaluate(h => {
        const card = getComputedStyle(h.shadowRoot.querySelector('.card'));
        return [card.backgroundColor, card.position, card.borderTopLeftRadius];
    });
    expect(look).toEqual(['rgb(255, 255, 255)', 'fixed', '12px']);

    const message = 'strict csp ' + Math.random().toString(36).slice(2);
    await p.type('Bug').click();
    await p.message.fill(message);
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img', {name: 'Screenshot of this tab'})).toBeVisible();
    expect(await p.dialog.getByRole('img').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    await p.dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible();
    await page.waitForTimeout(1500);
    await page.getByRole('button', {name: 'Stop'}).click();
    const video = p.dialog.locator('video');
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(v => v.readyState)).toBeGreaterThan(0);
    await p.showPreview.click();
    await expect(p.preview).toContainText(message);
    await p.send.click();
    await expect(p.done).toBeVisible();

    const received = await (await request.get(`${base}/received/csp-page`)).json();
    const entry = received.find(e => e.report && e.report.message === message);
    expect(Object.keys(entry.files).sort()).toEqual(['screenshot', 'video']);

    expect(await page.evaluate(() => window.__violations)).toEqual([]);
    expect(consoleLog.filter(m => /Content Security Policy|Refused to/i.test(m.text))).toEqual([]);
});

// A recording across pages shows the next page in a frame, so it needs frame-src 'self' as well.
const {configure, begin, framed, stop} = require('./walk');
test.describe('a recording across pages under a strict CSP', () => {
    test.use({viewport: null});

    test('with frame-src \'self\' the recording follows to the next page with no violation', async ({page, base, inbox, receiver}) => {
        await page.addInitScript(() => {
            window.__violations = [];
            // the site's own inline style, handlers and data: icon are its business, not the widget's
            document.addEventListener('securitypolicyviolation', e => { if (!/^(style-src-attr|script-src-attr)$/.test(e.effectiveDirective) && e.blockedURI !== 'data') window.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`); });
        });
        await configure(page, inbox);
        await begin(page, base, 'walk-a.html?csp=frames');
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await page.waitForTimeout(800);
        const dialog = await stop(page);
        await expect(dialog.getByText(/The recording stopped because/)).toHaveCount(0);
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        const [entry] = await receiver.reports(1);
        expect(entry.report.pages.map(p => p.title)).toEqual(['Page A', 'Page B']);
        expect(await page.evaluate(() => window.__violations)).toEqual([]);
    });

    test('without it the recording stops at the next page and says the site does not let it be shown in a frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base, 'walk-a.html?csp=strict');
        await page.waitForTimeout(800);
        await page.locator('#toB').click();
        const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
        await expect(dialog.locator('video')).toBeVisible();
        await expect(dialog.getByText('The recording stopped because this site does not let the next page be shown in a frame.')).toBeVisible();
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await page.waitForURL(/walk-b\.html$/);
    });
});

// Trusted Types: the widget's one policy, named feedback, is the only way it writes a script address or HTML.
test.describe('Trusted Types', () => {
    const TT = "require-trusted-types-for 'script'";
    for (const [name, policies, works] of [['allowed', 'trusted-types feedback', true], ['not allowed', 'trusted-types other', false]]) {
        test(`with the policy feedback ${name}, the panel ${works ? 'opens and records across pages' : 'does not open and the console says which policy to allow'}`, async ({page, load, consoleLog}) => {
            await load({init: true, headers: {'Content-Security-Policy': `${TT}; ${policies}`}});
            await page.locator('#trigger').click();
            const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
            if (works) {
                await expect(dialog).toBeVisible();
                // the frame of a recording across pages is made through the policy too
                await dialog.getByRole('radio', {name: 'Bug'}).click();
                await dialog.getByRole('button', {name: 'Record screen'}).click();
                await expect(page.locator('[data-feedback-panel] .pill button')).toBeVisible();
                await expect(page.locator('iframe[data-feedback-frame]')).toHaveCount(1);
                await page.waitForTimeout(1200); // a moment of frames: a recording stopped at once can be empty
                await page.locator('[data-feedback-panel] .pill button').click();
                await expect(dialog.locator('video')).toBeVisible();
                expect(consoleLog.filter(m => /Trusted Type|feedback:/.test(m.text))).toEqual([]);
            } else {
                await expect.poll(() => consoleLog.filter(m => m.type === 'error' && m.text.includes('feedback: Trusted Types refused the panel: allow the policy "feedback"')).length).toBe(1);
                await expect(dialog).toHaveCount(0);
            }
        });
    }
});
