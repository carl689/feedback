// The answer table: every row produces its message and keeps or clears the form.
'use strict';
const {test, expect, openPanel, sendReport} = require('./fixtures');

/** Sends once against a scripted answer and returns the panel. */
async function answeredWith(page, load, receiver, answers, options) {
    await receiver.script(answers);
    await load(options);
    return sendReport(page, {message: 'the message'});
}
async function expectKept(p) {
    await expect(p.dialog).toBeVisible();
    await expect(p.message).toHaveValue('the message');
    await expect(p.type('Bug')).toHaveAttribute('aria-checked', 'true');
}

test('2xx with an empty body: Sent, and the form is cleared for the next report', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 204});
    await expect(p.done).toHaveText(/Sent\.\s*Thank you\. Your report was sent\./);
    await expect(p.close).toBeFocused();
    await p.close.click();
    await expect(page.locator('#trigger')).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem('feedback.draft'))).toBeNull();
    const again = await openPanel(page);
    await expect(again.message).toHaveValue('');
    await expect(again.type('Bug')).toHaveAttribute('aria-checked', 'false');
    await again.type('Bug').click();
    await again.message.fill('second');
    await again.send.click();
    const [first, second] = await receiver.reports(2);
    expect(second.report.id).not.toBe(first.report.id);
});

test('2xx with an id and a message: "Sent, #id" and the receiver\'s words', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', onSent: e => { window.__sent = e.id; }}`});
    await receiver.script({status: 201, json: {id: 42, message: 'Thanks, we read every one.'}});
    const p = await sendReport(page);
    await expect(p.done).toHaveText(/Sent, #42\s*Thanks, we read every one\./);
    expect(await page.evaluate(() => window.__sent)).toBe('42');
});

test('a success envelope whose error is null or false is a success', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 200, json: {error: null, id: '9'}});
    await expect(p.done).toContainText('Sent, #9');
    await p.close.click();
    await receiver.script({status: 200, json: {error: false}});
    await sendReport(page);
    await expect(p.done).toContainText('Sent.');
});

test('400 invalid shows the receiver\'s message and keeps the form', async ({page, load, receiver, endpoint}) => {
    await load({init: `{endpoint: '${endpoint}', onError: e => { window.__error = e; }}`});
    await receiver.script({status: 400, json: {error: {code: 'invalid', message: 'The message is too short.', field: 'message'}}});
    const p = await sendReport(page, {message: 'the message'});
    await expect(p.alert).toHaveText('The message is too short.');
    await expectKept(p);
    await expect(p.send).toHaveText('Send');
    expect(await page.evaluate(() => window.__error)).toEqual({status: 400, code: 'invalid', message: 'The message is too short.'});
});

test('422 with no body says it was refused and keeps the form', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 422});
    await expect(p.alert).toHaveText('The report was refused. Check it, then send again.');
    await expectKept(p);
});

test('unsupportedVersion says the page is out of date', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 400, json: {error: {code: 'unsupportedVersion'}}});
    await expect(p.alert).toHaveText('This page is out of date. Reload it, then send again. Your message is kept.');
    await expectKept(p);
});

test('401 from a dispatcher says to sign in again and the draft survives the reload', async ({page, load, receiver, endpoint}) => {
    await receiver.script({status: 401, json: {error: 'Authentication required', authRequired: true}});
    const url = await load();
    const p = await sendReport(page, {message: 'the message'});
    await expect(p.alert).toHaveText('Authentication required. Sign in again, then send. Your message is kept.');
    await expectKept(p);
    const id = (await receiver.reports(1))[0].report.id;
    await page.goto(url);
    const again = await openPanel(page);
    await expectKept(again);
    await again.send.click();
    expect((await receiver.reports(2))[1].report.id).toBe(id);
});

test('403 with no body says to sign in again', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 403, text: 'Forbidden'});
    await expect(p.alert).toHaveText('Sign in again, then send. Your message is kept.');
    await expectKept(p);
});

test('a non-JSON 413 offers to send without the screenshot, and that send carries the same id', async ({page, load, receiver}) => {
    await receiver.script([{status: 413, type: 'text/html', text: '<html><body><h1>413 Request Entity Too Large</h1></body></html>'}, {status: 200, json: {id: 'ok'}}]);
    await load();
    const p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('the message');
    await page.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toBeVisible();
    await p.send.click();
    await expect(p.alert).toContainText('The report is too large to send.');
    await expect(p.alert.locator('h1')).toHaveCount(0);
    await p.alert.getByRole('button', {name: 'Send without the screenshot'}).click();
    await expect(p.done).toContainText('Sent, #ok');
    const [first, second] = await receiver.reports(2);
    expect(Object.keys(first.files)).toEqual(['screenshot']);
    expect(Object.keys(second.files)).toEqual([]);
    expect(second.report.id).toBe(first.report.id);
    expect(second.report).not.toHaveProperty('attachments');
});

test('415 naming a part that is not attached makes no offer', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 415, json: {error: {code: 'unsupportedMedia', message: 'Recordings must be WebM.', field: 'video'}}});
    await expect(p.alert).toHaveText('Recordings must be WebM.');
    await expect(p.alert.getByRole('button')).toHaveCount(0);
    await expectKept(p);
});

test('429 says to try again later, at the time in Retry-After, when that time is sane', async ({page, load, receiver}) => {
    const inTwoHours = new Date(Date.now() + 2 * 3600000).toUTCString();
    const p = await answeredWith(page, load, receiver, [
        {status: 429, headers: {'Retry-After': '90'}},
        {status: 429, headers: {'Retry-After': inTwoHours}, json: {error: {code: 'rateLimited', message: 'Ten an hour.'}}},
        {status: 429},
        // garbage, a date years away, a negative or fractional number: no time at all, never "Invalid Date"
        {status: 429, headers: {'Retry-After': 'Wed, 21 Oct 2037 07:28:00 GMT'}},
        {status: 429, headers: {'Retry-After': '99999999999999999999'}},
        {status: 429, headers: {'Retry-After': '-5'}},
        {status: 429, headers: {'Retry-After': '1.5'}},
        {status: 429, headers: {'Retry-After': 'soon'}}
    ]);
    await expect(p.alert).toHaveText(/^Too many reports were sent\. Try again after \d{1,2}:\d\d:\d\d.*\.$/);
    await p.send.click();
    await expect(p.alert).toHaveText(/^Ten an hour\. Too many reports were sent\. Try again after \d{1,2}:\d\d.*\.$/);
    for (let i = 0; i < 6; i++) {
        await p.send.click();
        await expect(p.alert).toHaveText('Too many reports were sent. Try again later.');
    }
    await expectKept(p);
});

test('503 disabled says so and keeps the draft', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 503});
    await expect(p.alert).toHaveText('Feedback cannot be received at the moment. Your message is kept; try again later.');
    await expectKept(p);
    expect(JSON.parse(await page.evaluate(() => sessionStorage.getItem('feedback.draft'))).message).toBe('the message');
});

test('a 500 says it could not be sent and offers Retry, which carries the same id', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, [{status: 500, text: 'Internal Server Error'}, {status: 200, json: {id: '2'}}]);
    await expect(p.alert).toHaveText('It could not be sent. Check your connection, then retry.');
    await expect(p.send).toHaveText('Retry');
    await expectKept(p);
    await p.send.click();
    await expect(p.done).toContainText('Sent, #2');
    const [first, second] = await receiver.reports(2);
    expect(second.report.id).toBe(first.report.id);
});

test('the three dispatcher allowances: a 200 with an error is a refusal, its text, a numeric code as status', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, [
        {status: 200, json: {error: {code: 413, msg: 'Too big for us.'}}},
        {status: 200, json: {error: {code: 'rateLimited'}, message: 'Slow down.'}},
        {status: 200, json: {error: 'Nope.'}},
        {status: 200, json: {error: {code: 503}}}
    ]);
    await expect(p.alert).toHaveText('Too big for us.');
    await p.send.click();
    await expect(p.alert).toHaveText('Slow down.');
    await p.send.click();
    await expect(p.alert).toHaveText('Nope.');
    await p.send.click();
    await expect(p.alert).toHaveText('Feedback cannot be received at the moment. Your message is kept; try again later.');
    await expectKept(p);
});

test('a redirect is a failure and nothing is posted where it points', async ({page, load, receiver, request, base}) => {
    const before = await (await request.get(`${base}/elsewhere-count`)).json();
    const p = await answeredWith(page, load, receiver, {redirect: '/elsewhere'});
    await expect(p.alert).toHaveText('It could not be sent. Check your connection, then retry.');
    await expectKept(p);
    expect(await (await request.get(`${base}/elsewhere-count`)).json()).toBe(before);
});

test('a timeout and a dropped connection are failures', async ({page, load, receiver, endpoint}) => {
    await receiver.script([{status: 200, delayMs: 2500, json: {id: 'late'}}, {drop: true}]);
    await load({init: `{endpoint: '${endpoint}', timeoutMs: 1000}`});
    const p = await sendReport(page, {message: 'the message'});
    await expect(p.alert).toHaveText('It could not be sent. Check your connection, then retry.');
    await expectKept(p);
    await p.send.click();
    await expect(p.send).toHaveText('Retry');
    await expect(p.alert).toHaveText('It could not be sent. Check your connection, then retry.');
});

test('the receiver\'s text is shown as text, cut to 300 characters', async ({page, load, receiver}) => {
    const long = '<b>bold</b> ' + 'w'.repeat(400);
    const p = await answeredWith(page, load, receiver, {status: 400, json: {error: {code: 'invalid', message: long}}});
    await expect(p.alert).toHaveText(long.slice(0, 300));
    await expect(p.alert.locator('b')).toHaveCount(0);
});

test('an unknown 4xx says it was refused with its status', async ({page, load, receiver}) => {
    const p = await answeredWith(page, load, receiver, {status: 404, text: 'Not Found'});
    await expect(p.alert).toHaveText('The report was refused (404).');
    await expectKept(p);
});
