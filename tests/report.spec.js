// What the report holds: the collect switches, scrubbing, the preview and beforeSend.
'use strict';
const {test, expect, openPanel, sendReport} = require('./fixtures');

for (const block of ['errors', 'requests', 'client']) {
    test(`collect.${block} false leaves ${block} out of the report and the line`, async ({page, load, receiver, base}) => {
        await load({attrs: {collect: {[block]: false}}});
        await page.evaluate(async origin => {
            console.error('expected-in-test e');
            await (await fetch(origin + '/pages/a.txt')).text(); // read, so the timing entry is complete
        }, base);
        const p = await openPanel(page);
        const line = {errors: '1 console error', requests: 'recent request', client: 'your browser'}[block];
        await expect(p.sentLine).not.toContainText(line);
        await p.type('Bug').click();
        await p.message.fill('x');
        await p.send.click();
        const r = (await receiver.reports(1))[0].report;
        expect(r).not.toHaveProperty(block);
        for (const other of ['errors', 'requests', 'client'].filter(b => b !== block)) expect(r).toHaveProperty(other);
    });
}

test('the also-sent line names what the settings send', async ({page, load, endpoint, base}) => {
    await load({init: `{endpoint: '${endpoint}', user: {id: 1, name: 'Ada'}, context: {app: 'desk'}}`});
    await page.evaluate(async origin => {
        console.error('expected-in-test 1');
        console.warn('expected-in-test 2');
        for (let i = 0; i < 3; i++) await (await fetch(origin + '/pages/r' + i + '.txt')).text();
    }, base);
    // the line counts what the browser's timing buffer holds when the panel opens
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/pages/r')).length)).toBe(3);
    const p = await openPanel(page);
    await expect(p.sentLine).toHaveText('Also sent: this page\'s address, your browser, 2 console errors, 3 recent requests, ' +
        'your name as this page knows it, and details this site adds.');
});

test('scrubParams blanks values in the query and the fragment, and a URL\'s user:password', async ({page, load, receiver, base}) => {
    const query = '?token=abc&page=2&access_token=zz&barcode=123&apiKey=k1#state=s&code=xyz&view=full';
    await load({attrs: {scrubParams: ['token', 'code', 'key', 'state']}}, query);
    await page.evaluate(async origin => {
        console.error('expected-in-test failed https://ada:hunter2@example.com/a?Signature=s1&id=4 then');
        await (await fetch(origin + '/pages/q.txt?token=t9&x=1')).text();
    }, base);
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('x');
    await p.showPreview.click();
    const preview = JSON.parse(await p.preview.textContent());
    await p.send.click();
    const r = (await receiver.reports(1))[0].report;
    expect(r.url).toMatch(/\?token=…&page=2&access_token=…&barcode=123&apiKey=…#state=…&code=…&view=full$/);
    // the host's names add to the built-in ones: signature is still blanked
    expect(r.errors[0].message).toBe('expected-in-test failed https://…@example.com/a?Signature=…&id=4 then');
    expect(r.requests.map(q => q.url)).toContain(`${base}/pages/q.txt?token=…&x=1`);
    expect(preview.url).toBe(r.url);
    expect(preview.errors).toEqual(r.errors);
});

test('the built-in patterns blank a Bearer token, a JWT and a card number, and scrubPatterns adds more', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', scrubPatterns: [/internal-\\w+/, 'ticket #\\\\d+']}`});
    await page.evaluate(() => {
        console.error('expected-in-test Authorization: Bearer abc.DEF-123_xyz== sent');
        console.error('expected-in-test jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-part_9 end');
        console.error('expected-in-test card 4111 1111 1111 1111 and 5500-0055-5555-5559, not 1732377600000');
        console.error('expected-in-test host internal-db7 and ticket #4417');
    });
    await sendReport(page);
    const messages = (await receiver.reports(1))[0].report.errors.map(e => e.message);
    expect(messages).toEqual([
        'expected-in-test Authorization: Bearer … sent',
        'expected-in-test jwt … end',
        'expected-in-test card … and …, not 1732377600000',
        'expected-in-test host … and …'
    ]);
});

test('the preview is the report as it will be sent, filled as text', async ({page, load, receiver}) => {
    await load();
    const p = await openPanel(page);
    await p.type('Message').click();
    await p.message.fill('<img src=x onerror=alert(1)>');
    await p.showPreview.click();
    await expect(p.preview).toBeVisible();
    await expect(page.getByRole('button', {name: 'Hide what is sent'})).toHaveAttribute('aria-expanded', 'true');
    const preview = JSON.parse(await p.preview.textContent());
    expect(await p.preview.evaluate(pre => pre.children.length)).toBe(0);
    await p.message.fill('<img src=x onerror=alert(1)> more');
    await expect(p.preview).toContainText('more');
    await p.send.click();
    const r = (await receiver.reports(1))[0].report;
    for (const k of ['schemaVersion', 'id', 'widgetVersion', 'type', 'url', 'title', 'openedAt', 'client']) expect(preview[k]).toEqual(r[k]);
    expect(r.message).toBe('<img src=x onerror=alert(1)> more');
});

test('beforeSend can change the report', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', beforeSend: async report => { report.message = report.message.toUpperCase(); delete report.client; report.context = {added: true}; return report; }}`});
    await sendReport(page, {message: 'quiet words'});
    const r = (await receiver.reports(1))[0].report;
    expect(r.message).toBe('QUIET WORDS');
    expect(r).not.toHaveProperty('client');
    expect(r.context).toEqual({added: true});
});

test('beforeSend returning false cancels: nothing is sent and the form is kept', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', beforeSend: () => { window.__asked = (window.__asked || 0) + 1; return false; }}`});
    const p = await sendReport(page, {message: 'keep me'});
    await expect.poll(() => page.evaluate(() => window.__asked)).toBe(1);
    await expect(p.send).toBeEnabled();
    await expect(p.message).toHaveValue('keep me');
    await page.waitForTimeout(300);
    expect(await receiver.received()).toEqual([]);
});

test('the whole report is held under 256 KB', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', errorBufferSize: 100, messageMaxLength: 20000}`});
    await page.evaluate(() => {
        for (let i = 0; i < 100; i++) {
            const e = new Error('expected-in-test ' + i + ' ' + '€'.repeat(600));
            e.stack = '€'.repeat(3000);
            console.error(e);
        }
    });
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('€'.repeat(20000));
    await p.send.click();
    const [entry] = await receiver.reports(1);
    expect(Buffer.byteLength(entry.reportText)).toBeLessThanOrEqual(262144);
    expect(entry.report.message).toHaveLength(20000);
    expect(entry.report.errors.length).toBeGreaterThan(0);
});
