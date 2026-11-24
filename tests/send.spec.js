// The request and the report: what arrives at a receiver when a person sends.
'use strict';
const {test, expect, openPanel, sendReport} = require('./fixtures');

test('a report arrives as multipart form data with the report as a text field', async ({page, load, receiver}) => {
    await load({attrs: {project: 'demo', environment: 'staging', release: 'abc1234', fields: {action: 'submit'}}});
    const p = await sendReport(page, {type: 'Feature request', message: '  Please add dark mode  '});
    await expect(p.done).toContainText('Sent, #1');
    const [entry] = await receiver.reports(1);
    expect(entry.headers.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(entry.order).toEqual(['action', 'report']);
    expect(entry.fields).toEqual({action: 'submit'});
    expect(entry.headers.custom).toBeNull();
    const r = entry.report;
    expect(Object.keys(r).slice(0, 10)).toEqual(['schemaVersion', 'id', 'widgetVersion', 'type', 'message', 'url', 'title', 'openedAt', 'sentAt', 'project']);
    expect(r.schemaVersion).toBe(1);
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(r.widgetVersion).toBe('1.2.0');
    expect(r.type).toBe('feature');
    expect(r.message).toBe('  Please add dark mode  '); // sent as typed
    expect(r.url).toBe(page.url());
    expect(r.title).toBe('Feedback test page');
    expect(r.openedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(Date.parse(r.sentAt)).toBeGreaterThanOrEqual(Date.parse(r.openedAt));
    expect(r).toMatchObject({project: 'demo', environment: 'staging', release: 'abc1234'});
    expect(r).not.toHaveProperty('referrer');
    expect(r).not.toHaveProperty('user');
    expect(r).not.toHaveProperty('context');
    expect(r).not.toHaveProperty('attachments');
    expect(Object.keys(r.client).sort()).toEqual(['language', 'online', 'pixelRatio', 'screen', 'timeZone', 'touch', 'userAgent', 'viewport']);
    expect(r.client.viewport).toEqual([1280, 720]);
});

test('Send stays disabled until a type is picked and the message has more than whitespace', async ({page, load}) => {
    await load();
    const p = await openPanel(page);
    await expect(p.send).toBeDisabled();
    await p.message.fill('words');
    await expect(p.send).toBeDisabled();
    await p.type('Bug').click();
    await expect(p.send).toBeEnabled();
    await p.message.fill('   \n\t  ');
    await expect(p.send).toBeDisabled();
    await p.message.fill(' x ');
    await expect(p.send).toBeEnabled();
});

test('a context deeper than 16 levels or over 16 KB is left out with one warning', async ({page, load, receiver, consoleLog, endpoint}) => {
    const deep = 'JSON.parse(\'{"a":\'.repeat(16) + \'1\' + \'}\'.repeat(16))';
    await load({init: `{endpoint: '${endpoint}', context: ${deep}}`});
    await sendReport(page);
    const [entry] = await receiver.reports(1);
    expect(entry.report).not.toHaveProperty('context');
    expect(consoleLog.filter(m => m.text.includes('"context"'))).toHaveLength(1);
    await page.getByRole('button', {name: 'Close'}).click();

    // the deepest a context may be: the report around it makes 16 levels
    await page.evaluate(() => feedback.setContext({context: JSON.parse('{"a":'.repeat(15) + '1' + '}'.repeat(15))}));
    await sendReport(page);
    const second = (await receiver.reports(2))[1].report;
    let depth = 0;
    for (let v = second.context; v && typeof v === 'object'; v = v.a) depth++;
    expect(depth).toBe(15);
    await page.getByRole('button', {name: 'Close'}).click();

    await page.evaluate(() => feedback.setContext({context: {big: 'x'.repeat(17000)}}));
    await sendReport(page);
    expect((await receiver.reports(3))[2].report).not.toHaveProperty('context');
    expect(consoleLog.filter(m => m.text.includes('"context"'))).toHaveLength(2);
});

test('user and context come from settings and setContext, copied once', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', user: {id: 7, name: 'Ada', password: 'x'}, context: {app: 'desktop'}}`});
    await page.evaluate(() => feedback.setContext({user: {id: 'u-9', name: 'Grace'}}));
    await sendReport(page);
    const r = (await receiver.reports(1))[0].report;
    expect(r.user).toEqual({id: 'u-9', name: 'Grace'});
    expect(r.context).toEqual({app: 'desktop'});
});

test('the message is capped at messageMaxLength with a counter near the limit', async ({page, load, receiver}) => {
    await load({attrs: {messageMaxLength: 20}});
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('0123456789');
    await expect(page.getByText('characters left')).toBeHidden();
    await p.message.pressSequentially('abcdefghijKLMNOP');
    await expect(page.getByText('0 characters left')).toBeVisible();
    await expect(p.message).toHaveValue('0123456789abcdefghij');
    await p.send.click();
    expect((await receiver.reports(1))[0].report.message).toBe('0123456789abcdefghij');
});

test('requests are same-origin resource entries, newest requestCount, oldest first', async ({page, load, receiver, base}) => {
    await load({attrs: {requestCount: 3}});
    await page.evaluate(async origin => {
        for (let i = 1; i <= 5; i++) await (await fetch(`${origin}/pages/nothing-${i}.txt`)).text(); // read, so the timing entry is complete
        await fetch('https://example.invalid/x').catch(() => {});
    }, base);
    await sendReport(page);
    const r = (await receiver.reports(1))[0].report;
    expect(r.requests.map(q => q.url)).toEqual([3, 4, 5].map(i => `${base}/pages/nothing-${i}.txt`));
    for (const q of r.requests) {
        expect(q.status).toBe(404);
        expect(Number.isInteger(q.ms)).toBe(true);
        expect(q.at).toMatch(/Z$/);
    }
});
