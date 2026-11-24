// A recording across pages, after the report: the exit from the frame and the edges of the lazy state.
// Each test pins one finding of the review of the first build.
'use strict';
const {test, expect, pageHtml} = require('./fixtures');
const {colourAt, configure, dialogOf, stopButton, keepFrame, recording, begin, framed, unframed, stop, lazyOn, facts} = require('./walk');

const OTHER = process.env.FEEDBACK_OTHER;

test.describe('the lazy exit', () => {
    test('a download as the next navigation: the file arrives and the person stays on the framed page, never on a blank one', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        const [download] = await Promise.all([page.waitForEvent('download'), keepFrame(page).locator('#download').click()]);
        expect(download.suggestedFilename()).toBe('report.csv');
        await page.waitForTimeout(1500);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-b.html`, frames: 1, shown: true, blank: false});
        // and the next link still leaves for real
        await keepFrame(page).locator('#toC').click();
        await page.waitForURL(/walk-c\.html$/);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
    });

    test('a 204 as the next navigation: nothing happens, the person stays on the framed page', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        await keepFrame(page).locator('#nothing').click();
        await page.waitForTimeout(1500);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-b.html`, frames: 1, shown: true, blank: false});
    });

    test('a link to a section of the page the recording began on loads that page, at that section', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        await keepFrame(page).locator('#toALower').click();
        await page.waitForFunction(() => /walk-a\.html#lower$/.test(location.href) && !document.querySelector('iframe[data-feedback-frame]'), null, {timeout: 10000});
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page A', frames: 0});
        expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1500);
    });

    test('the person sees the framed page, a blank moment, then the page loaded for real: never the next page twice', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        await page.evaluate(() => {
            window.__seen = [];
            const f = document.querySelector('iframe[data-feedback-frame]');
            const look = () => {
                let at = '';
                try { at = f.contentWindow.location.pathname; } catch {}
                window.__seen.push(getComputedStyle(f).visibility === 'hidden' ? 'blank' : at);
                requestAnimationFrame(look);
            };
            look();
        });
        await keepFrame(page).locator('#toC').click();
        await page.waitForURL(/walk-c\.html$/);
        // the frame never showed page C: the old page, then blank, then the window's own page C
        const seen = await page.evaluate(() => window.__seen).catch(() => null);
        if (seen) expect(seen.filter(s => /walk-c/.test(s))).toEqual([]);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
    });

    test('Stay at a framed page\'s "Leave site?" keeps the person there; the declined address is never gone to, and the exit works again', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-c.html`);
        await lazyOn(page, base, {to: 'walk-dirty.html'});
        await keepFrame(page).locator('#dirtyField').fill('unsaved words');
        const asked = [];
        let answer = 'dismiss';
        page.on('dialog', d => { asked.push(d.type()); d[answer]().catch(() => {}); });
        // a link: asked, Stay
        await keepFrame(page).locator('#toC').click();
        await expect.poll(() => asked.length).toBe(1);
        await page.waitForTimeout(800);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-dirty.html`, frames: 1, shown: true, blank: false});
        expect(await keepFrame(page).locator('#dirtyField').inputValue()).toBe('unsaved words');
        // another site: asked during the exit's rewind, Stay
        await keepFrame(page).locator('#other').click();
        await expect.poll(() => asked.length).toBe(2);
        await page.waitForTimeout(800);
        expect(await facts(page)).toMatchObject({url: `${base}/site/walk-dirty.html`, frames: 1, shown: true});
        // later, Back (the browser's): asked again, Leave; Back again to the page the recording began on
        answer = 'accept';
        await page.goBack({waitUntil: 'commit', timeout: 5000}).catch(() => {});
        await framed(page, /walk-b\.html$/);
        await page.goBack({waitUntil: 'commit', timeout: 5000}).catch(() => {});
        await unframed(page, /walk-a\.html$/);
        await page.waitForTimeout(500);
        expect(page.url()).toBe(`${base}/site/walk-a.html`); // not the declined other site
        // the next link from the first page goes for real
        await page.locator('#toC').click();
        await page.waitForURL(/walk-c\.html$/);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
    });

    test('Back to the first page after a report, then a link: the window goes for real, not into the frame again', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        await page.goBack({waitUntil: 'commit', timeout: 5000}).catch(() => {});
        await unframed(page, /walk-a\.html$/);
        await page.locator('#toC').click();
        await page.waitForURL(/walk-c\.html$/);
        await page.waitForLoadState();
        expect(await facts(page)).toMatchObject({title: 'Page C', frames: 0});
    });

    test('a held recording (Cancel) survives a link: the frame keeps following, and the recording is still in the panel', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base, {send: false});
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        expect(await facts(page)).toMatchObject({frames: 1, shown: true});
        await keepFrame(page).locator('#trigger').click();
        await expect(dialogOf(page).locator('video')).toBeVisible();
    });

    test('after three framed pages a redirect to another site ends there, and Back is the first page with no dead presses', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-c.html`);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await keepFrame(page).locator('#toC').click();
        await framed(page, /walk-c\.html$/);
        await keepFrame(page).locator('#toA').click();
        await framed(page, /walk-a\.html$/);
        await keepFrame(page).locator('#toOther').click(); // same site, answered 302 to another site that allows framing
        const dialog = dialogOf(page);
        await expect(dialog.getByText('The recording stopped because the next page is on another site.')).toBeVisible();
        await dialog.getByRole('button', {name: 'Cancel'}).click();
        await page.waitForURL(`${OTHER}/other.html`);
        const trail = [];
        for (let i = 0; i < 2; i++) {
            await page.goBack({waitUntil: 'load', timeout: 5000}).catch(() => {});
            trail.push(page.url().replace(base, ''));
        }
        expect(trail).toEqual(['/site/walk-a.html', '/site/walk-c.html']);
    });
});

test.describe('the framed page and the rest of the window', () => {
    test('reset(), setContext() and close() called on a framed page reach the panel above', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base, {send: false});
        const frame = keepFrame(page);
        await frame.locator('#trigger').click();
        const dialog = dialogOf(page);
        await expect(dialog).toBeVisible();
        await frame.evaluate(() => window.feedback.close());
        await expect(dialog).toBeHidden();
        await frame.evaluate(() => {
            window.feedback.reset();
            window.feedback.setContext({user: {id: 'next-person', name: 'Next'}});
        });
        await frame.locator('#trigger').click();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('textbox', {name: 'Your message'})).toHaveValue('');
        await expect(dialog.locator('video')).toHaveCount(0);
        await dialog.getByRole('button', {name: 'Show exactly what is sent'}).click();
        expect(JSON.parse(await dialog.locator('pre').textContent()).user).toEqual({id: 'next-person', name: 'Next'});
    });

    test('a second report does not carry the first\'s errors or the covered page\'s old ones', async ({page, base, inbox, receiver}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-a.html`);
        await page.evaluate(() => console.error('expected-in-test old error on the first page'));
        await lazyOn(page, base, {fresh: false});
        const first = (await receiver.reports(1))[0].report;
        expect(first.errors.map(e => e.message)).toEqual(expect.arrayContaining(['expected-in-test old error on the first page', 'expected-in-test error on page B']));
        // after the report: one new error on the covered page and one on the framed page
        await page.evaluate(() => console.error('expected-in-test new error beneath'));
        await keepFrame(page).evaluate(() => console.error('expected-in-test new error on page B'));
        await keepFrame(page).locator('#trigger').click();
        const dialog = dialogOf(page);
        await dialog.getByRole('radio', {name: 'Bug'}).click();
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('second report');
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        const second = (await receiver.reports(2))[1].report;
        const messages = (second.errors || []).map(e => e.message);
        expect(messages).toEqual(['expected-in-test new error on page B']);
        expect(second).not.toHaveProperty('pages');
        for (const q of second.requests || []) expect(Date.parse(q.at)).toBeGreaterThanOrEqual(Date.parse(first.sentAt));
    });

    test('printing while framed prints the framed page: the covered page left out, the frame as tall as its page', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await lazyOn(page, base);
        await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        const during = await page.evaluate(() => {
            const layer = document.querySelector('[data-feedback-frame-layer]');
            const f = layer.querySelector('iframe');
            return {others: [...document.body.children].filter(el => el !== layer).map(el => getComputedStyle(el).display),
                position: getComputedStyle(layer).position, frameHeight: f.getBoundingClientRect().height,
                pageHeight: f.contentDocument.documentElement.scrollHeight, rootOverflow: document.documentElement.style.overflow};
        });
        expect(new Set(during.others)).toEqual(new Set(['none']));
        expect(during.position).toBe('static');
        expect(during.frameHeight).toBe(during.pageHeight);
        expect(during.pageHeight).toBeGreaterThan(2000);
        expect(during.rootOverflow).toBe('');
        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        const after = await page.evaluate(() => {
            const layer = document.querySelector('[data-feedback-frame-layer]');
            return {others: [...document.body.children].filter(el => el !== layer && el.tagName !== 'SCRIPT' && !el.hasAttribute('data-feedback-panel')).map(el => getComputedStyle(el).display),
                position: getComputedStyle(layer).position, rootOverflow: document.documentElement.style.overflow};
        });
        expect(after.others).not.toContain('none');
        expect(after).toMatchObject({position: 'fixed', rootOverflow: 'hidden'});
    });

    test('a popover open on the first page at the swap stays beneath the framed page', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.evaluate(() => {
            const p = document.createElement('div');
            p.id = 'firstPopover';
            p.popover = 'manual';
            p.textContent = 'a popover of the first page';
            p.style.cssText = 'background: rgb(255, 0, 0); width: 300px; height: 200px';
            document.body.append(p);
            p.showPopover();
        });
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        const centre = await page.evaluate(() => {
            const r = document.getElementById('firstPopover').getBoundingClientRect();
            return [document.getElementById('firstPopover').matches(':popover-open'), r.left + r.width / 2, r.top + r.height / 2];
        });
        expect(centre[0]).toBe(true);
        expect(await colourAt(page, centre[1], centre[2])).not.toEqual([255, 0, 0]); // page B is painted there, not the popover
        await stopButton(page).click();
        await expect(dialogOf(page).locator('video')).toBeVisible();
    });

    test('a modal dialog the covered page opens by itself later stays beneath: the frame, the keyboard and Stop are above it', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        await page.evaluate(() => {
            const d = document.createElement('dialog');
            d.id = 'lateDialog';
            d.innerHTML = '<p>Your session is about to end</p><button id="lateOk">OK</button>';
            d.style.cssText = 'background: rgb(255, 0, 0); width: 300px; height: 200px';
            document.body.append(d);
            d.showModal();
        });
        await page.waitForTimeout(400);
        const now = await page.evaluate(() => ({
            late: document.getElementById('lateDialog').matches(':modal'),
            centre: document.elementFromPoint(innerWidth / 2, innerHeight / 2).tagName,
            active: document.activeElement.tagName
        }));
        expect(now).toEqual({late: true, centre: 'IFRAME', active: 'IFRAME'});
        const box = await page.locator('#lateDialog').boundingBox();
        expect(await colourAt(page, box.x + box.width / 2, box.y + box.height / 2)).not.toEqual([255, 0, 0]);
        await keepFrame(page).evaluate(() => { window.__keys = ''; document.addEventListener('keydown', e => { window.__keys += e.key; }); });
        await page.keyboard.type('ok');
        expect(await keepFrame(page).evaluate(() => window.__keys)).toBe('ok');
        await stopButton(page).click({timeout: 3000});
        await expect(dialogOf(page).locator('video')).toBeVisible();
    });

    test('the pill is the last Tab stop, after the framed page; the frame\'s layer is no dialog to assistive technology', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await begin(page, base);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        expect(await page.evaluate(() => {
            const host = document.querySelector('[data-feedback-panel]');
            const layer = document.querySelector('[data-feedback-frame-layer]');
            return !!(layer.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING);
        })).toBe(true);
        // what Chrome gives a screen reader: the page, then the framed page, no unnamed dialog between
        const cdp = await page.context().newCDPSession(page);
        const {nodes} = await cdp.send('Accessibility.getFullAXTree');
        expect(nodes.filter(n => !n.ignored && n.role && n.role.value === 'dialog')).toEqual([]);
        expect(nodes.some(n => !n.ignored && n.role && n.role.value === 'Iframe' && n.name && n.name.value === 'Page B')).toBe(true);
        // from the framed page's last control, Tab reaches Stop
        await keepFrame(page).evaluate(() => {
            const all = [...document.querySelectorAll('a[href], button, input')].filter(e => e.getClientRects().length && !e.disabled);
            all[all.length - 1].focus();
        });
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => {
            const a = document.activeElement;
            return a.hasAttribute('data-feedback-panel') && a.shadowRoot.activeElement && a.shadowRoot.activeElement.textContent;
        })).toBe('Stop');
    });

    test('a page\'s own rules for dialog[open] do not move the frame\'s layer', async ({page, base, inbox}) => {
        await configure(page, inbox);
        await page.goto(`${base}/site/walk-a.html`);
        await page.addStyleTag({content: 'dialog[open] { padding: 40px !important; margin: 30px !important; border: 8px solid red !important; max-width: 50% !important; opacity: .5 }'});
        await begin(page, base, null);
        await page.locator('#toB').click();
        await framed(page, /walk-b\.html$/);
        const box = await page.locator('[data-feedback-frame-layer]').evaluate(d => {
            const r = d.getBoundingClientRect();
            return [r.left, r.top, r.width === innerWidth, r.height === innerHeight, getComputedStyle(d).opacity];
        });
        expect(box).toEqual([0, 0, true, true, '1']);
    });
});

test('at the start of a recording made from an item of a menu that has closed, focus is left on the body, not given to the menu\'s toggle', async ({page, load, endpoint}) => {
    const menu = `<div><button type="button" id="toggle" aria-controls="menu" onclick="document.getElementById('menu').hidden = false">Help</button>
        <ul id="menu" aria-labelledby="toggle" hidden><li><button type="button" id="item" data-feedback onclick="document.getElementById('menu').hidden = true">Send feedback</button></li></ul></div>`;
    await load({body: menu});
    await page.locator('#toggle').click();
    await page.locator('#item').click();
    const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
    await dialog.getByRole('button', {name: 'Record screen'}).click();
    await expect(page.locator('[data-feedback-panel] .pill button')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.type('B1795');
    await page.keyboard.press('Enter');
    await expect(page.locator('#menu')).toBeHidden(); // a scan's Enter did not open the menu
    expect(await page.locator('[data-feedback-panel] .pill button').isVisible()).toBe(true);
    void endpoint;
});

test.describe('the recording\'s length', () => {
    test('a recording has a length in the panel and as received, and can be sought to its middle', async ({page, load, receiver}) => {
        await load();
        await page.locator('#trigger').click();
        const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
        await dialog.getByRole('radio', {name: 'Bug'}).click();
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('with a length');
        await dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(page.locator('[data-feedback-panel] .pill button')).toBeVisible();
        await page.evaluate(() => { const p = document.createElement('p'); p.id = 'ticker'; document.body.append(p); setInterval(() => { p.textContent = String(Date.now()); }, 100); });
        await page.waitForTimeout(2500);
        await page.locator('[data-feedback-panel] .pill button').click();
        const video = dialog.locator('video');
        await expect(video).toBeVisible();
        const check = async locator => locator.evaluate(v => new Promise(resolve => {
            const go = () => {
                const duration = v.duration;
                if (!Number.isFinite(duration)) return resolve({duration: String(duration)});
                v.addEventListener('seeked', () => resolve({duration, at: v.currentTime}), {once: true});
                v.currentTime = duration / 2;
            };
            if (v.readyState >= 1) go(); else v.addEventListener('loadedmetadata', go, {once: true});
        }));
        const inPanel = await check(video);
        expect(inPanel.duration).toBeGreaterThan(2);
        expect(inPanel.duration).toBeLessThan(6);
        expect(Math.abs(inPanel.at - inPanel.duration / 2)).toBeLessThan(0.5);
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        const [entry] = await receiver.reports(1);
        const received = await page.evaluate(async b64 => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const v = document.createElement('video');
            v.muted = true;
            v.src = URL.createObjectURL(new Blob([bytes], {type: 'video/webm'}));
            document.body.append(v);
            await new Promise(r => v.addEventListener('loadedmetadata', r, {once: true}));
            return v.duration;
        }, entry.files.video.base64);
        expect(received).toBeCloseTo(inPanel.duration, 1);
        expect(received * 1000).toBeCloseTo(entry.report.attachments.video.ms, -2);
    });

    test('a file not of the expected shape comes back byte for byte as it was', async ({page, load}) => {
        await load();
        await page.locator('#trigger').click(); // loads the panel
        await expect(page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'})).toBeVisible();
        const results = await page.evaluate(async () => {
            const fix = window[Symbol.for('feedback.stub')].webmWithDuration;
            const same = async (bytes, type = 'video/webm') => {
                const out = await fix(new Blob([bytes], {type}), 1234);
                const back = new Uint8Array(await out.arrayBuffer());
                return back.length === bytes.length && back.every((b, i) => b === bytes[i]);
            };
            const random = Uint8Array.from({length: 4000}, (_, i) => (i * 7919 + 13) % 256);
            // an EBML header, then a Segment with a known size: not the recorder's shape
            const sizedSegment = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x84, 1, 2, 3, 4, ...new Uint8Array(20)]);
            // an unsized Segment whose first child is a Cluster: no Info before it
            const clusterFirst = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00, ...new Uint8Array(20)]);
            // an unsized Segment with an Info that already has a Duration
            const withDuration = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                0x15, 0x49, 0xa9, 0x66, 0x87, 0x44, 0x89, 0x84, 0x40, 0x00, 0x00, 0x00, ...new Uint8Array(20)]);
            return {empty: await same(new Uint8Array(0)), random: await same(random), sizedSegment: await same(sizedSegment),
                clusterFirst: await same(clusterFirst), withDuration: await same(withDuration)};
        });
        expect(results).toEqual({empty: true, random: true, sizedSegment: true, clusterFirst: true, withDuration: true});
    });
});

void pageHtml;
void recording;
void stop;
