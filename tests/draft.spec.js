// The draft: the typed message and type survive a reload, belong to one user.id, and reset() ends them.
'use strict';
const {test, expect, openPanel} = require('./fixtures');

const userInit = endpoint => `{endpoint: '${endpoint}', user: {id: new URLSearchParams(location.search).get('u'), name: 'n'}}`;

test('the draft survives a reload, with the same report id', async ({page, load, receiver}) => {
    const url = await load();
    let p = await openPanel(page);
    await p.type('Feature request').click();
    await p.message.fill('typed before the reload');
    await p.showPreview.click();
    const id = JSON.parse(await p.preview.textContent()).id;
    await page.goto(url);
    p = await openPanel(page);
    await expect(p.message).toHaveValue('typed before the reload');
    await expect(p.type('Feature request')).toHaveAttribute('aria-checked', 'true');
    await p.send.click();
    expect((await receiver.reports(1))[0].report.id).toBe(id);
});

test('a draft typed under one user.id is discarded when the panel opens under another', async ({page, load, endpoint}) => {
    const url = await load({init: userInit(endpoint)}, '?u=ada');
    let p = await openPanel(page);
    await p.message.fill('ada was here');
    await page.goto(url.replace('u=ada', 'u=grace'));
    p = await openPanel(page);
    await expect(p.message).toHaveValue('');
    await page.goto(url);
    p = await openPanel(page);
    await expect(p.message).toHaveValue('');
});

test('a person signing in while the page is open does not inherit the draft in memory', async ({page, load, endpoint}) => {
    await load({init: userInit(endpoint)}, '?u=ada');
    const p = await openPanel(page);
    await p.message.fill('ada was here');
    await p.cancel.click();
    await page.evaluate(() => feedback.setContext({user: {id: 'grace'}}));
    await page.locator('#trigger').click();
    await expect(p.message).toHaveValue('');
});

test('attachments are never written to storage', async ({page, load}) => {
    await load();
    const p = await openPanel(page);
    await p.message.fill('with a screenshot');
    await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
    await expect(p.dialog.getByRole('img')).toBeVisible();
    const stored = await page.evaluate(() => Object.keys(sessionStorage).map(k => [k, sessionStorage.getItem(k).length]));
    expect(stored).toHaveLength(1);
    expect(stored[0][0]).toBe('feedback.draft');
    expect(stored[0][1]).toBeLessThan(400);
});

test('reset() empties the draft, the form and the error buffer', async ({page, load, receiver}) => {
    await load();
    await page.evaluate(() => console.error('expected-in-test before sign-out'));
    let p = await openPanel(page);
    await p.type('Bug').click();
    await p.message.fill('the last person\'s words');
    await p.cancel.click();
    await page.evaluate(() => feedback.reset());
    expect(await page.evaluate(() => sessionStorage.getItem('feedback.draft'))).toBeNull();
    p = await openPanel(page);
    await expect(p.message).toHaveValue('');
    await expect(p.sentLine).not.toContainText('console error');
    await p.type('Bug').click();
    await p.message.fill('the next person');
    await p.send.click();
    expect((await receiver.reports(1))[0].report).not.toHaveProperty('errors');
});

test('reset() before the panel ever loaded empties the buffer too', async ({page, load, receiver}) => {
    await load();
    await page.evaluate(() => {
        console.error('expected-in-test early');
        sessionStorage.setItem('feedback.draft', JSON.stringify({user: null, message: 'old', type: 'bug'}));
        feedback.reset();
    });
    const p = await openPanel(page);
    await expect(p.message).toHaveValue('');
    await p.type('Bug').click();
    await p.message.fill('fresh');
    await p.send.click();
    expect((await receiver.reports(1))[0].report).not.toHaveProperty('errors');
});
