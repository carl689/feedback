// A recording follows the person from page to page: the multi-page test site in pages/site/,
// one test for each kind of navigation, then the report, the exit and the edges.
'use strict';
const {test, expect} = require('./fixtures');

const OTHER = process.env.FEEDBACK_OTHER;

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
        if (!f || getComputedStyle(f.parentElement).visibility !== 'visible') return false;
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
const facts = page => page.evaluate(() => ({url: location.href, title: document.title, historyLength: history.length,
    frames: document.querySelectorAll('iframe[data-feedback-frame]').length}));
const back = page => page.evaluate(() => history.back());
const forward = page => page.evaluate(() => history.forward());

test.describe('each kind of navigation, with a recording running', () => {
    test('a link: on the first page and inside the frame, the address, title and history follow', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        const length = await page.evaluate(() => history.length);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        expect(await facts(page)).toMatchObject({title: 'Page B', historyLength: length + 1, frames: 1});
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        expect(await facts(page)).toMatchObject({title: 'Page C', historyLength: length + 2});
        expect(await recording(page)).toBe(true);
        await stop(page);
    });

    test('a navigation by script, on the first page and inside the frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#scriptNav').click();
        await framed(page, /walk-c\.html$/);
        await keepFrame(page).evaluate(() => { setTimeout(() => { location.href = 'walk-b.html'; }, 50); });
        await framed(page, /walk-b\.html$/);
        expect(await recording(page)).toBe(true);
    });

    test('a GET form, on the first page and inside the frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#q').fill('socks');
        await page.locator('#getSubmit').click();
        await framed(page, /walk-c\.html\?q=socks$/);
        await keepFrame(page).locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#q').fill('hats');
        await keepFrame(page).locator('#getSubmit').click();
        await framed(page, /walk-c\.html\?q=hats$/);
        expect(await recording(page)).toBe(true);
    });

    test('an address pushed by script (a filter applied) stays on its page, and in the frame the address follows', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#pushState').click();
        await expect(page.locator('#filtered')).toHaveText('filtered');
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-a.html?filter=1`, frames: 1});
        expect(await page.locator('iframe[data-feedback-frame]').evaluate(f => getComputedStyle(f.parentElement).visibility)).toBe('hidden');
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).evaluate(() => history.pushState({}, '', '?pushed=1'));
        await page.waitForFunction(() => /walk-b\.html\?pushed=1$/.test(location.href));
        expect(await recording(page)).toBe(true);
    });

    test('a POST form with a text field and a file, and a POST answered with a redirect', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#note').fill('hello');
        await page.locator('#upload').setInputFiles({name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('twelve bytes')});
        await page.locator('#postSubmit').click();
        await framed(page, /\/post-echo$/);
        const posted = await keepFrame(page).locator('#posted li').allInnerTexts();
        expect(posted).toEqual(['note=hello', 'upload=file note.txt 12']);
        expect(await facts(page)).toMatchObject({title: 'Posted'});
        await keepFrame(page).locator('#toA').click();
        await framed(page, /walk-a\.html$/);
        await keepFrame(page).locator('#redirectSubmit').click();
        await framed(page, /walk-c\.html\?posted=1$/);
        expect(await recording(page)).toBe(true);
    });

    test('a POST answered with a redirect, from the first page', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#redirectSubmit').click();
        await framed(page, /walk-c\.html\?posted=1$/);
        expect(await facts(page)).toMatchObject({title: 'Page C'});
        expect(await recording(page)).toBe(true);
    });

    test('Back and Forward: through the framed pages, to the first page as it was, and back again', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        // the page stays usable while recording
        await page.locator('#typed').fill('typed before');
        await page.evaluate(() => window.scrollTo(0, 600));
        await page.evaluate(() => { window.__firstDocument = 'still here'; });
        const length = await page.evaluate(() => history.length);
        await page.locator('#toBLower').evaluate(a => a.click());
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        await back(page);
        await framed(page, /walk-b\.html$/);
        expect(await facts(page)).toMatchObject({title: 'Page B', historyLength: length + 2});
        await back(page);
        await unframed(page, /walk-a\.html$/);
        expect(await facts(page)).toMatchObject({title: 'Page A', historyLength: length + 2});
        expect(await page.evaluate(() => [window.__firstDocument, document.getElementById('typed').value, scrollY,
            [...document.body.children].filter(e => e.inert).length])).toEqual(['still here', 'typed before', 600, 0]);
        // the keyboard is back in the first page
        await page.keyboard.type(' and after');
        await expect(page.locator('#typed')).toHaveValue('typed before and after');
        await forward(page);
        await framed(page, /walk-b\.html$/);
        await forward(page);
        await framed(page, /walk-c\.html$/);
        await keepFrame(page).evaluate(() => history.back());
        await framed(page, /walk-b\.html$/);
        expect(await recording(page)).toBe(true);
    });

    test('Back past the first page asks to leave: Stay keeps the recording, Leave ends it', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-c.html`);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await back(page);
        await unframed(page, /walk-a\.html$/);
        const asked = [];
        let answer = 'dismiss';
        page.on('dialog', d => { asked.push(d.type()); d[answer]().catch(() => {}); });
        await back(page);
        await expect.poll(() => asked.length).toBe(1);
        await page.waitForTimeout(300);
        expect(page.url()).toBe(`${base}/site/walk-a.html`);
        expect(await recording(page)).toBe(true);
        answer = 'accept';
        await back(page);
        await page.waitForURL(/walk-c\.html$/);
        expect(asked).toEqual(['beforeunload', 'beforeunload']);
    });

    test('reloads: by script on the first page, the browser\'s own Reload (asked, Stay), by script in the frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.evaluate(() => { window.__firstDocument = 'still here'; });
        await page.locator('#scriptReload').click();
        await framed(page, /walk-a\.html$/);
        expect(await page.evaluate(() => window.__firstDocument)).toBe('still here');
        await keepFrame(page).evaluate(() => { window.__frameMarker = 1; });
        const asked = [];
        page.on('dialog', d => { asked.push(d.type()); d.dismiss().catch(() => {}); });
        await page.reload({timeout: 2500}).catch(() => {});
        expect(asked).toEqual(['beforeunload']);
        expect(await page.evaluate(() => window.__firstDocument)).toBe('still here');
        expect(await keepFrame(page).evaluate(() => window.__frameMarker)).toBe(1);
        await keepFrame(page).locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).evaluate(() => { window.__frameMarker = 2; });
        await keepFrame(page).locator('#scriptReload').click();
        await page.waitForFunction(() => {
            const f = document.querySelector('iframe[data-feedback-frame]');
            try { return !f.contentWindow.__frameMarker && f.contentDocument.readyState === 'complete'; } catch { return false; }
        });
        expect(await recording(page)).toBe(true);
        expect(page.url()).toBe(`${base}/site/walk-b.html`);
    });

    test('a link to a new tab, on the first page and inside the frame', async ({page, context, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        const [first] = await Promise.all([context.waitForEvent('page'), page.locator('#newTab').click()]);
        await first.waitForLoadState();
        expect(first.url()).toBe(`${base}/site/walk-b.html`);
        await first.close();
        expect(await recording(page)).toBe(true);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-a.html`});
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#toA').click();
        await framed(page, /walk-a\.html$/);
        const [second] = await Promise.all([context.waitForEvent('page'), keepFrame(page).locator('#newTab').click()]);
        await second.close();
        expect(await recording(page)).toBe(true);
        await framed(page, /walk-a\.html$/);
    });

    test('downloads: a link answered as an attachment and an <a download>, on the first page and in the frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        const [one] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
        expect(one.suggestedFilename()).toBe('report.csv');
        await page.waitForTimeout(500);
        expect(await recording(page)).toBe(true);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-a.html`, title: 'Page A'});
        await page.locator('#toB').click(); // the first page still works
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#toA').click();
        await framed(page, /walk-a\.html$/);
        const [two] = await Promise.all([page.waitForEvent('download'), keepFrame(page).locator('#download').click()]);
        expect(two.suggestedFilename()).toBe('report.csv');
        const [three] = await Promise.all([page.waitForEvent('download'), keepFrame(page).locator('#downloadAttr').click()]);
        expect(three.suggestedFilename()).toBe('b.html');
        await page.waitForTimeout(500);
        expect(await recording(page)).toBe(true);
        await framed(page, /walk-a\.html$/);
    });

    test('hash links: on the first page and in the frame, and Back through them', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#hash').click();
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-a.html#lower`});
        await page.locator('#toBLower').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#hash').click();
        await framed(page, /walk-b\.html#lower$/);
        await back(page);
        await framed(page, /walk-b\.html$/);
        await back(page);
        await unframed(page, /walk-a\.html#lower$/);
        expect(await recording(page)).toBe(true);
    });

    test('a search typed with the keyboard and its result chosen with Enter, on the first page and in the frame', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base, 'walk-c.html');
        await page.locator('#search').click();
        await page.keyboard.type('blue', {delay: 20});
        await page.keyboard.press('Enter');
        await framed(page, /walk-b\.html\?q=blue$/);
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        await keepFrame(page).locator('#search').click();
        await page.keyboard.type('red', {delay: 20});
        await page.keyboard.press('Enter');
        await framed(page, /walk-b\.html\?q=red$/);
        expect(await recording(page)).toBe(true);
    });

    test('a link aimed at the whole window is followed; what the page beneath asks for by itself is dropped', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base, 'walk-timer.html');
        await page.locator('#arm').click(); // the first page will reload itself, then send itself to page C
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#toTop').click(); // target=_top: the person's own click
        await framed(page, /walk-c\.html$/);
        await page.waitForTimeout(2200); // the first page's timers have fired and been dropped
        await framed(page, /walk-c\.html$/);
        expect(await recording(page)).toBe(true);
    });

    test('a script in the framed page sending the whole window elsewhere is dropped, as the page beneath\'s would be', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#setTop').click();
        await page.waitForTimeout(800);
        await framed(page, /walk-b\.html$/);
        expect(await recording(page)).toBe(true);
    });
});

test.describe('leaving the site', () => {
    for (const [name, link, ends] of [
        ['a link to another site', '#other', /\/other\.html$/],
        ['a link to another site that refuses framing', '#otherDeny', /\/other-deny\.html$/],
        ['a same-site address that redirects to another site', '#toOther', /\/other\.html$/],
        ['a same-site address that redirects to a site refusing framing', '#toOtherDeny', /\/other-deny\.html$/]
    ]) {
        test(`${name} ends the recording, keeps it, says why, and the window goes there when the panel closes`, async ({page, base, inbox}) => {
            await configure(page, inbox);
            await begin(page, base);
            await page.locator('#toB').click();
            await framed(page, /walk-b\.html$/);
            await keepFrame(page).locator('#toA').click();
            await framed(page, /walk-a\.html$/);
            await keepFrame(page).locator(link).click();
            const dialog = dialogOf(page);
            await expect(dialog.locator('video')).toBeVisible();
            await expect(dialog.getByText('The recording stopped because the next page is on another site.')).toBeVisible();
            expect(page.url()).not.toMatch(ends);
            await dialog.getByRole('button', {name: 'Cancel'}).click();
            await page.waitForURL(ends);
            // the frame's history was rewound first: Back is the page the recording began on, no dead steps
            await page.goBack();
            await page.waitForURL(/walk-a\.html$/);
            expect(await page.evaluate(() => document.querySelectorAll('iframe[data-feedback-frame]').length)).toBe(0);
        });
    }

    test('a link to another site from the first page ends the recording the same way', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.waitForTimeout(1000);
        await page.locator('#other').click();
        const dialog = dialogOf(page);
        await expect(dialog.getByText('The recording stopped because the next page is on another site.')).toBeVisible();
        await expect(dialog.locator('video')).toBeVisible();
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await page.waitForURL(`${OTHER}/other.html`);
    });
});

test.describe('the report and the exit', () => {
    test.use({viewport: null}); // the real window: an emulated viewport can crop the pill out of the capture

    test('a report after three pages carries pages, each error\'s page, failed requests first, and the whole walk on video', async ({page, base, inbox, receiver}) => {
        await configure(page, inbox, {requestCount: 3});
        const started = Date.now();
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await page.waitForTimeout(800);
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        await expect.poll(() => keepFrame(page).evaluate(() => performance.getEntriesByType('resource').filter(e => e.responseStatus === 404).length)).toBe(2);
        await page.waitForTimeout(1000);
        const walked = (Date.now() - started) / 1000;
        const dialog = await stop(page);
        await expect(dialog.locator('.sent-line')).toContainText('3 pages visited');
        await dialog.getByRole('button', {name: 'Show exactly what is sent'}).click();
        const preview = JSON.parse(await dialog.locator('pre').textContent());
        expect(preview.pages.map(p => p.title)).toEqual(['Page A', 'Page B', 'Page C']);
        // the recording's real length, read by playing it to its end (a recorder's WebM states none)
        const seconds = await dialog.locator('video').evaluate(v => new Promise(resolve => {
            const done = () => { if (Number.isFinite(v.duration)) resolve(v.duration); };
            v.addEventListener('durationchange', done);
            v.currentTime = 1e6;
            done();
        }));
        expect(seconds).toBeGreaterThanOrEqual(walked - 1.5);
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        const r = (await receiver.reports(1))[0].report;
        expect(r.url).toBe(`${base}/site/walk-c.html`);
        expect(r.title).toBe('Page C');
        expect(r.pages.map(p => [p.url, p.title])).toEqual([
            [`${base}/site/walk-a.html`, 'Page A'], [`${base}/site/walk-b.html`, 'Page B'], [`${base}/site/walk-c.html`, 'Page C']]);
        for (const p of r.pages) expect(p.at).toMatch(/Z$/);
        const onB = r.errors.filter(e => e.page === `${base}/site/walk-b.html`).map(e => e.kind).sort();
        expect(onB).toEqual(['console.error', 'exception']);
        const onC = r.errors.filter(e => e.page === `${base}/site/walk-c.html`).map(e => e.kind);
        expect(onC).toContain('resource');
        expect(r.requests).toHaveLength(3);
        const failed = r.requests.filter(q => q.status >= 400).map(q => q.url).sort();
        expect(failed).toEqual([`${base}/site/missing-image.png`, `${base}/site/no-such-data.json`]);
        for (const q of r.requests) expect(q.page).toMatch(/\/site\/walk-[abc]\.html$/);
        expect(r.attachments.video.ms).toBeGreaterThanOrEqual((walked - 1.5) * 1000);
    });

    test('after Send the person stays in the frame with what they typed; the next link leaves for real, and Back is the first page', async ({page, base, inbox, receiver}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-c.html`);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#typedB').fill('typed in the frame');
        await keepFrame(page).evaluate(() => window.scrollTo(0, 500));
        const dialog = await stop(page);
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        await dialog.getByRole('button', {name: 'Close'}).click();
        await framed(page, /walk-b\.html$/);
        expect(await keepFrame(page).evaluate(() => [document.getElementById('typedB').value, scrollY])).toEqual(['typed in the frame', 500]);
        await receiver.reports(1);
        // the next navigation out of the framed page leaves for real
        await keepFrame(page).locator('#toC').click();
        await page.waitForURL(/walk-c\.html$/);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
        await page.goBack();
        await page.waitForURL(/walk-a\.html$/);
        await page.goBack();
        await page.waitForURL(/walk-c\.html$/);
    });

    test('Cancel keeps the unsent recording, and a trigger pressed inside the frame opens the one panel', async ({page, base, inbox}) => {
        await configure(page, inbox, {launcher: true});
        await begin(page, base);
        const requests = [];
        page.on('request', q => { if (q.url().includes('feedbackPanel.js')) requests.push(q.frame() === page.mainFrame() ? 'top' : 'frame'); });
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        const dialog = await stop(page);
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await framed(page, /walk-b\.html$/);
        const frame = keepFrame(page);
        expect(await frame.evaluate(() => [document.querySelectorAll('[data-feedback-panel]').length, [...document.querySelectorAll('button')].filter(b => b.textContent === 'Feedback' && b.style.position === 'fixed').length])).toEqual([0, 0]);
        await frame.locator('#trigger').click();
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('video')).toBeVisible();
        expect(await frame.evaluate(() => document.querySelectorAll('[data-feedback-panel]').length)).toBe(0);
        expect(requests).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        expect(await frame.evaluate(() => document.activeElement.id)).toBe('trigger');
    });
});

test.describe('the edges', () => {
    test('video.follow false: the old note, no frame, and the recording ends at the page change', async ({page, base, inbox}) => {
        await configure(page, inbox, {video: {follow: false}});
        await page.goto(`${base}/site/walk-a.html`);
        await page.locator('#trigger').click();
        await expect(dialogOf(page).getByText('A recording stops if this page reloads or you leave it.')).toBeVisible();
        await dialogOf(page).getByRole('button', {name: 'Record screen'}).click();
        await expect(stopButton(page)).toBeVisible();
        expect(await facts(page)).toMatchObject({frames: 0});
        await page.locator('#toB').click();
        await page.waitForURL(/walk-b\.html$/);
        await page.waitForLoadState();
        expect(await page.locator('[data-feedback-panel]').count()).toBe(0);
    });

    test('without the Navigation API: the old note and the old behavior', async ({page, base, inbox}) => {
        await page.addInitScript(() => {
            try { delete window.navigation; } catch {}
            try { Object.defineProperty(window, 'navigation', {value: undefined, configurable: true}); } catch {}
        });
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-a.html`);
        await page.locator('#trigger').click();
        await expect(dialogOf(page).getByText('A recording stops if this page reloads or you leave it.')).toBeVisible();
        await dialogOf(page).getByRole('button', {name: 'Record screen'}).click();
        await expect(stopButton(page)).toBeVisible();
        await page.locator('#toB').click();
        await page.waitForURL(/walk-b\.html$/);
        await page.waitForLoadState();
        expect(await page.locator('[data-feedback-panel]').count()).toBe(0);
    });

    test('the note says the recording follows when it can', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-a.html`);
        await page.locator('#trigger').click();
        await expect(dialogOf(page).getByText('The recording follows you from page to page on this site. It stops if you leave the site.')).toBeVisible();
    });

    test('the stub in a frame of another site\'s page is an ordinary stub and touches nothing above', async ({page, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${OTHER}/other-frames.html`);
        const inner = page.frameLocator('#inner');
        await inner.locator('#trigger').click();
        await expect(inner.getByRole('dialog', {name: 'Send feedback'})).toBeVisible();
        expect(await page.evaluate(() => document.querySelectorAll('[data-feedback-panel], [data-feedback-frame-layer]').length)).toBe(0);
    });

    test('the time limit reached on a framed page stops the recording there, and the panel opens over it', async ({page, base, inbox}) => {
        await configure(page, inbox, {video: {maxSeconds: 3}});
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        const dialog = dialogOf(page);
        await expect(dialog.locator('video')).toBeVisible({timeout: 8000});
        await expect(dialog.getByText('The recording stopped at its time limit.')).toBeVisible();
        await framed(page, /walk-b\.html$/);
    });

    test('Stop while the next page is on its way: the click is not lost, inside the frame or from the first page', async ({page, base, inbox}) => {
        await configure(page, inbox);
        let hold = 0;
        await page.route('**/site/walk-c.html', async route => { if (hold) await new Promise(r => setTimeout(r, hold)); return route.continue(); });
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        hold = 4000; // long enough that Stop and Cancel always come first
        await keepFrame(page).locator('#toC').click();
        let dialog = await stop(page);
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await framed(page, /walk-c\.html$/); // the page asked for arrives and is shown
        expect(await facts(page)).toMatchObject({title: 'Page C'});

        // from the first page: the window goes to the page asked for, for real
        hold = 0;
        await page.goto(`${base}/site/walk-a.html`);
        dialog = await begin(page, base, null);
        hold = 4000; // long enough that Stop and Cancel always come first
        await page.locator('#toC').click();
        dialog = await stop(page);
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await page.waitForURL(/walk-c\.html$/);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
    });

    test('typing straight after the page changes lands in the framed page; the pill never takes it', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.keyboard.type('x'); // on the first page, focus is back where it was: nothing presses Stop
        expect(await recording(page)).toBe(true);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).evaluate(() => { window.__keys = ''; document.addEventListener('keydown', e => { window.__keys += e.key; }); });
        await page.keyboard.type('scan1');
        await page.keyboard.press('Enter');
        expect(await keepFrame(page).evaluate(() => window.__keys)).toBe('scan1Enter');
        expect(await recording(page)).toBe(true);
    });

    test('a trapped modal in the framed page: the pill\'s Stop opens the panel, which takes the keyboard', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#toModal').click();
        await framed(page, /walk-modal\.html$/);
        const dialog = await stop(page);
        expect(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-feedback-panel'))).toBe(true);
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('over the modal in the frame');
        await expect(dialog.getByRole('textbox', {name: 'Your message'})).toHaveValue('over the modal in the frame');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await framed(page, /walk-modal\.html$/);
    });

    test('a native modal dialog on the first page: the frame shows above it, the pill and the panel above that', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-native.html`);
        await begin(page, base, null);
        await page.locator('#native #toB').click();
        await framed(page, /walk-b\.html$/);
        expect(await page.locator('[data-feedback-frame-layer]').evaluate(d => d.matches(':modal'))).toBe(true);
        await keepFrame(page).locator('#typedB').fill('above the dialog');
        const dialog = await stop(page);
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('panel above the frame');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await framed(page, /walk-b\.html$/);
        await back(page);
        await unframed(page, /walk-native\.html$/);
        expect(await page.locator('#native').evaluate(d => d.open && d.matches(':modal'))).toBe(true);
    });
});
