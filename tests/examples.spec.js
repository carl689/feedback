// The widget against the two independent receivers, examples/receiver.js and examples/receiver.php,
// second and third implementations of the protocol, run as they are, reached through receiver.js's
// same-origin proxy because they answer no CORS. The PHP one runs under `php -S` when php is on the
// path; without it those tests are skipped and say so. FEEDBACK_EXAMPLES_DIR runs another copy.
'use strict';
const {spawn, spawnSync} = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const {test, expect, openPanel} = require('./fixtures');

const EXAMPLES = process.env.FEEDBACK_EXAMPLES_DIR || path.join(__dirname, '..', 'examples');
const PHP = spawnSync('php', ['-r', 'echo PHP_VERSION;'], {encoding: 'utf8'});
const HAS_PHP = PHP.status === 0 && /^8\.([2-9]|\d\d)/.test(PHP.stdout);

const freePort = () => new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const {port} = s.address(); s.close(() => resolve(port)); });
});

/** Starts one example receiver; dir null leaves FEEDBACK_DIR unset. Resolves {port, stop, problems}. */
async function startExample(kind, dir, outDir) {
    const env = Object.assign({}, process.env);
    delete env.FEEDBACK_DIR;
    if (dir) env.FEEDBACK_DIR = dir;
    let child, port, errorLog = '';
    if (kind === 'node') {
        child = spawn(process.execPath, [path.join(EXAMPLES, 'receiver.js')], {env: Object.assign(env, {PORT: '0'}), stdio: ['ignore', 'pipe', 'pipe']});
    } else {
        port = await freePort();
        errorLog = path.join(outDir, 'php-errors.log');
        fs.mkdirSync(outDir, {recursive: true});
        fs.writeFileSync(errorLog, '');
        // four workers, so requests at the same instant really are at the same instant
        child = spawn('php', ['-d', 'upload_max_filesize=16M', '-d', 'post_max_size=17M', '-d', 'display_errors=0', '-d', 'log_errors=1',
            '-d', 'error_log=' + errorLog, '-S', `127.0.0.1:${port}`, path.join(EXAMPLES, 'receiver.php')],
            {env: Object.assign(env, {PHP_CLI_SERVER_WORKERS: '4'}), stdio: ['ignore', 'pipe', 'pipe']});
    }
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    const exited = new Promise((resolve, reject) => child.on('exit', code => reject(new Error(`the ${kind} example exited (${code}): ${stderr}`))));
    exited.catch(() => {});
    if (kind === 'node') {
        port = await Promise.race([exited, new Promise(resolve => {
            let out = '';
            child.stdout.on('data', d => {
                out += d;
                const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
                if (m) resolve(Number(m[1]));
            });
        })]);
    } else {
        for (let i = 0; ; i++) {
            const up = await new Promise(resolve => net.connect(port, '127.0.0.1').on('connect', function () { this.end(); resolve(true); }).on('error', () => resolve(false)));
            if (up) break;
            if (i > 100) throw new Error('php -S did not start: ' + stderr);
            await new Promise(r => setTimeout(r, 50));
        }
    }
    return {
        port,
        stop: () => child.kill(),
        // what the receiver itself reported going wrong: Node's stderr, PHP's error log (php -S logs every request to stderr)
        problems: () => kind === 'node' ? stderr
            // PHP's own refusal of a body over post_max_size is logged as a warning; the receiver answers it 413
            : fs.readFileSync(errorLog, 'utf8').split('\n').filter(l => l && !/PHP Request Startup: POST Content-Length of \d+ bytes exceeds the limit/.test(l)).join('\n')
    };
}

const KINDS = ['node', 'php'];
const exampleTest = test.extend({
    kind: ['node', {option: true}],
    /** The example receiver on a free port, storing in a fresh directory of this test's own. */
    example: async ({kind}, use, testInfo) => {
        test.skip(kind === 'php' && !HAS_PHP, 'php 8.2 or later is not on the path, so receiver.php is not run');
        const dir = testInfo.outputPath('reports');
        fs.mkdirSync(dir, {recursive: true});
        const r = await startExample(kind, dir, testInfo.outputPath(kind));
        await use({port: r.port, dir, stored: () => fs.readdirSync(dir).sort()});
        r.stop();
        expect(r.problems(), `the ${kind} example receiver reported a problem`).toBe('');
    }
});

/** Opens the panel on a page whose endpoint is the example, and keeps what beforeSend saw. */
async function exampleLoad(load, example, settings = '') {
    return load({title: '', init: `{endpoint: '/proxy/${example.port}/', beforeSend: report => { window.__sent = JSON.parse(JSON.stringify(report)); return report; }${settings}}`});
}
function answers(page, port) {
    const list = [];
    page.on('response', r => { if (r.url().includes(`/proxy/${port}/`)) list.push(r.status()); });
    return list;
}

for (const kind of KINDS) exampleTest.describe(`the ${kind} example`, () => {
    exampleTest.use({kind});

    exampleTest('a minimal report: the eight required fields, stored as sent', async ({page, load, example}) => {
        const statuses = answers(page, example.port);
        await exampleLoad(load, example, ", collect: {errors: false, requests: false, client: false}");
        const p = await openPanel(page);
        await p.type('Message').click();
        await p.message.fill('Only what is required');
        await p.send.click();
        await expect(p.done).toContainText('Sent, #');
        expect(statuses).toEqual([201]);

        const sent = await page.evaluate(() => window.__sent);
        expect(Object.keys(sent).sort()).toEqual(['id', 'message', 'openedAt', 'schemaVersion', 'sentAt', 'type', 'url', 'widgetVersion']);
        await expect(p.done).toContainText(`Sent, #${sent.id}`);
        expect(example.stored()).toEqual([`${sent.id}.json`]);
        const record = JSON.parse(fs.readFileSync(path.join(example.dir, `${sent.id}.json`), 'utf8'));
        expect(record.report).toEqual(sent);
        expect(record.files).toEqual({});
    });

    exampleTest('a full report with a real screenshot and a three-second recording', async ({page, load, example, base}) => {
        const statuses = answers(page, example.port);
        await exampleLoad(load, example, ", project: 'shop', environment: 'staging', release: 'abc1234', user: {id: 'u-7', name: 'Ada'}, context: {app: 'desktop', nested: {list: [1, 2, 3]}}");
        await page.evaluate(async origin => {
            console.error('expected-in-test a console error');
            await (await fetch(origin + '/pages/missing.txt?token=secret')).text();
        }, base);
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('Everything attached');
        await p.dialog.getByRole('button', {name: 'Screenshot'}).click();
        await expect(p.dialog.getByRole('img')).toHaveCount(1);
        await p.dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(page.getByRole('button', {name: 'Stop'})).toBeVisible();
        await page.waitForTimeout(3000);
        await page.getByRole('button', {name: 'Stop'}).click();
        await expect(p.dialog.locator('video')).toHaveCount(1);
        await p.send.click();
        await expect(p.done).toContainText('Sent, #');
        expect(statuses).toEqual([201]);

        const sent = await page.evaluate(() => window.__sent);
        for (const k of ['user', 'context', 'client', 'errors', 'requests', 'attachments']) expect(sent).toHaveProperty(k);
        const record = JSON.parse(fs.readFileSync(path.join(example.dir, `${sent.id}.json`), 'utf8'));
        expect(record.report).toEqual(sent);
        expect(record.files.screenshot).toMatchObject({type: 'image/webp', bytes: sent.attachments.screenshot.bytes});
        expect(record.files.video).toMatchObject({type: 'video/webm', bytes: sent.attachments.video.bytes});
        const shot = fs.readFileSync(path.join(example.dir, record.files.screenshot.name));
        expect(shot.subarray(0, 4).toString('latin1') + shot.subarray(8, 12).toString('latin1')).toBe('RIFFWEBP');
        const video = fs.readFileSync(path.join(example.dir, record.files.video.name));
        expect(video.subarray(0, 4).toString('hex')).toBe('1a45dfa3');
        expect(sent.attachments.video.ms).toBeGreaterThanOrEqual(2900);
        expect(example.stored()).toEqual([`${sent.id}.json`, `${sent.id}.screenshot.webp`, `${sent.id}.video.webm`]);
    });

    exampleTest('a retry of a stored report is answered with the first one\'s id and stores nothing new', async ({page, load, example}) => {
        await exampleLoad(load, example);
        const p = await openPanel(page);
        await p.type('Bug').click();
        await p.message.fill('Sent twice');
        await p.send.click();
        await expect(p.done).toContainText('Sent, #');
        const sent = await page.evaluate(() => window.__sent);
        // the same report again, as a retry after a lost answer would send it
        const status = await page.evaluate(async ({port, report}) => {
            const body = new FormData();
            body.append('report', JSON.stringify(report));
            const r = await fetch(`/proxy/${port}/`, {method: 'POST', body});
            return [r.status, await r.json()];
        }, {port: example.port, report: sent});
        expect(status).toEqual([200, {id: sent.id}]);
        expect(example.stored()).toEqual([`${sent.id}.json`]);
    });

    exampleTest('a report from a recording across two pages, with pages and each error\'s page, is taken and stored as sent', async ({page, base, example}) => {
        const statuses = answers(page, example.port);
        await page.addInitScript(port => {
            try { sessionStorage.setItem('feedback.test', JSON.stringify({init: {endpoint: `/proxy/${port}/`}})); } catch {}
        }, example.port);
        await page.goto(`${base}/site/walk-a.html`);
        await page.locator('#trigger').click();
        const dialog = page.locator('[data-feedback-panel]').getByRole('dialog', {name: 'Send feedback'});
        await dialog.getByRole('radio', {name: 'Bug'}).click();
        await dialog.getByRole('textbox', {name: 'Your message'}).fill('across two pages');
        await dialog.getByRole('button', {name: 'Record screen'}).click();
        await expect(page.locator('[data-feedback-panel] .pill button')).toBeVisible();
        await page.locator('#toB').click();
        await page.waitForFunction(() => /walk-b\.html$/.test(location.href) && document.title === 'Page B');
        await page.waitForTimeout(1200);
        await page.locator('[data-feedback-panel] .pill button').click();
        await expect(dialog.locator('video')).toBeVisible();
        await dialog.getByRole('button', {name: 'Show exactly what is sent'}).click();
        const preview = JSON.parse(await dialog.locator('pre').textContent());
        await dialog.getByRole('button', {name: 'Send'}).click();
        await expect(dialog.locator('.done')).toBeVisible();
        expect(statuses).toEqual([201]);
        const record = JSON.parse(fs.readFileSync(path.join(example.dir, `${preview.id}.json`), 'utf8'));
        expect(record.report.pages.map(p => p.title)).toEqual(['Page A', 'Page B']);
        expect(record.report.errors.filter(e => /walk-b\.html$/.test(e.page)).length).toBeGreaterThan(0);
        const {sentAt, ...rest} = record.report;
        const {sentAt: previewSentAt, ...previewRest} = preview;
        for (const k of ['schemaVersion', 'id', 'type', 'message', 'url', 'title', 'pages', 'openedAt']) expect(rest[k]).toEqual(previewRest[k]);
        expect(record.files.video).toMatchObject({type: 'video/webm'});
    });
});

// The receivers' own handling, posted straight to them: what a browser on the page cannot vary.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const reportOf = extra => Object.assign({schemaVersion: 1, id: require('crypto').randomUUID(), widgetVersion: '1.2.0', type: 'bug',
    message: 'posted by hand', url: 'https://a.test/', openedAt: '2026-11-23T10:00:00Z', sentAt: '2026-11-23T10:01:00Z'}, extra);
const BOUNDARY = 'feedbackTestBoundary7MA4YWxk';   // Node's parser refused a one-letter one around PNG bytes
/** Posts a multipart body by hand: parts are [name, value] or [name, Buffer, filename, type]. */
async function post(port, parts) {
    const chunks = [];
    for (const [name, value, filename, type] of parts) {
        chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"` + (filename === undefined ? '' : `; filename="${filename}"\r\nContent-Type: ${type}`) + '\r\n\r\n'));
        chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
    const r = await fetch(`http://127.0.0.1:${port}/`, {method: 'POST', body: Buffer.concat(chunks), headers: {'Content-Type': 'multipart/form-data; boundary=' + BOUNDARY}});
    return [r.status, await r.json()];
}
/** A value n levels below the report: n = 1 is the context itself. */
const nested = n => { let v = 'leaf'; for (let i = 1; i < n; i++) v = {a: v}; return v; };

for (const kind of KINDS) exampleTest.describe(`the ${kind} example, posted to`, () => {
    exampleTest.use({kind});

    exampleTest('with no FEEDBACK_DIR it answers 503 disabled and stores nothing anywhere', async ({}, testInfo) => {
        test.skip(kind === 'php' && !HAS_PHP, 'php 8.2 or later is not on the path, so receiver.php is not run');
        const r = await startExample(kind, null, testInfo.outputPath(kind));
        try {
            const report = reportOf();
            const [status, body] = await post(r.port, [['report', report]]);
            expect(status).toBe(503);
            expect(body.error.code).toBe('disabled');
            expect(fs.existsSync(path.join(require('os').tmpdir(), 'feedback-reports', `${report.id}.json`))).toBe(false);
        } finally { r.stop(); }
        expect(r.problems()).toBe('');
    });

    exampleTest('what it stores is readable by its own user only', async ({example}) => {
        const report = reportOf();
        expect(await post(example.port, [['report', report], ['screenshot', PNG, 'shot.png', 'image/png']])).toEqual([201, {id: report.id}]);
        expect(example.stored()).toEqual([`${report.id}.json`, `${report.id}.screenshot.png`]);
        for (const name of example.stored()) expect(fs.statSync(path.join(example.dir, name)).mode & 0o077, name).toBe(0);
    });

    exampleTest('a file field sent with no file is no file, not a server error', async ({example}) => {
        const report = reportOf();
        // what a form's empty <input type="file"> sends
        expect(await post(example.port, [['report', report], ['screenshot', Buffer.alloc(0), '', 'application/octet-stream']])).toEqual([201, {id: report.id}]);
        expect(example.stored()).toEqual([`${report.id}.json`]);
        expect(JSON.parse(fs.readFileSync(path.join(example.dir, `${report.id}.json`), 'utf8')).files).toEqual({});
    });

    exampleTest('five copies of one report at the same instant are stored once and each answered with its id', async ({example}) => {
        const report = reportOf();
        const answers = await Promise.all(Array.from({length: 5}, () => post(example.port, [['report', report], ['screenshot', PNG, 'shot.png', 'image/png']])));
        expect(answers.map(a => a[0]).sort()).toEqual([200, 200, 200, 200, 201]);
        for (const [, body] of answers) expect(body).toEqual({id: report.id});
        expect(example.stored()).toEqual([`${report.id}.json`, `${report.id}.screenshot.png`]);
        expect(JSON.parse(fs.readFileSync(path.join(example.dir, `${report.id}.json`), 'utf8')).report.id).toBe(report.id);
    });

    exampleTest('an error\'s source is cut to 2,000 characters like its url', async ({example}) => {
        const long = 'https://a.test/' + 'a'.repeat(5000);
        const report = reportOf({errors: [{kind: 'exception', message: 'x', source: long, line: 1, column: 1, at: 1, count: 1}]});
        expect((await post(example.port, [['report', report]]))[0]).toBe(201);
        const stored = JSON.parse(fs.readFileSync(path.join(example.dir, `${report.id}.json`), 'utf8')).report;
        expect(stored.errors[0].source).toBe(long.slice(0, 2000));
    });

    exampleTest('a value 16 levels below the report is taken and one 17 levels below is refused, by both receivers alike', async ({example}) => {
        const edge = reportOf({context: nested(16)});
        expect(await post(example.port, [['report', edge]])).toEqual([201, {id: edge.id}]);
        const over = reportOf({context: nested(17)});
        const [status, body] = await post(example.port, [['report', over]]);
        expect([status, body.error.code, body.error.field]).toEqual([400, 'invalid', 'report']);
    });
});

// conformance.js against the examples, which must conform, and against a receiver built to be wrong.
const CONFORMANCE = process.env.FEEDBACK_CONFORMANCE || path.join(__dirname, 'conformance.js');
const conformance = (url, ...args) => new Promise(resolve => {
    const child = spawn(process.execPath, [CONFORMANCE, url, '--json', ...args], {stdio: ['ignore', 'pipe', 'inherit']});
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('exit', () => resolve(JSON.parse(out)));
});
const outcomes = result => Object.fromEntries(result.cases.map(c => [c.name, c.outcome]));

for (const kind of KINDS) exampleTest.describe(`conformance.js and the ${kind} example`, () => {
  exampleTest.use({kind});
  exampleTest('it conforms, the new cases included', async ({example}) => {
    exampleTest.setTimeout(60000);
    const result = await conformance(`http://127.0.0.1:${example.port}/`);
    expect(result.cases.filter(c => c.outcome === 'fail').map(c => `${c.name}: ${c.detail}`)).toEqual([]);
    expect(outcomes(result)).toMatchObject({'schema-version': 'pass', 'missing-id': 'pass', 'blank-message': 'pass', 'path-file-name': 'check'});
    // the uploaded name went nowhere: the stored screenshot has a name the receiver made
    expect(fs.existsSync(path.join(example.dir, '..', '..', 'conformance-path.png'))).toBe(false);
    expect(example.stored().filter(name => /conformance-path/.test(name))).toEqual([]);
  });
});

exampleTest('conformance.js fails a wrong version code, warns on a bare 400, and fails a blank message or a missing id taken', async () => {
    // accepts everything but schemaVersion 99, which it answers in the mode the path names
    const server = require('http').createServer((req, res) => {
        let body = '';
        req.on('data', d => { body += d; });
        req.on('end', () => {
            if (!/"schemaVersion":99/.test(body)) return res.writeHead(201, {'Content-Type': 'application/json'}).end('{}');
            if (req.url === '/badcode') return res.writeHead(400, {'Content-Type': 'application/json'}).end('{"error":{"code":"badVersion","message":"no"}}');
            res.writeHead(400, {'Content-Type': 'text/plain'}).end('Bad Request');
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const only = ['--only', 'schema-version,missing-id,blank-message'];
        expect(outcomes(await conformance(`${base}/badcode`, ...only))).toEqual({'schema-version': 'fail', 'missing-id': 'fail', 'blank-message': 'fail'});
        expect(outcomes(await conformance(`${base}/bare`, ...only))['schema-version']).toBe('warn');
    } finally { server.close(); }
});
