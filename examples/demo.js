// The widget on a made-up page, to try it before installing it. No dependencies, Node 18+.
//   FEEDBACK_DIR=/tmp/feedback-reports node examples/demo.js      then open http://127.0.0.1:8000/
// It serves demo.html and the widget's two files, starts receiver.js beside it on a free port and
// passes POST /feedback to it, so the page and its receiver are one origin. Reports are stored in
// FEEDBACK_DIR by receiver.js. PORT picks another port. For local use only.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

if (!process.env.FEEDBACK_DIR) {
    console.error('Say where to store the reports: FEEDBACK_DIR=/tmp/feedback-reports node examples/demo.js');
    process.exit(1);
}
const files = {
    '/': ['demo.html', 'text/html; charset=utf-8'],
    '/feedback.js': ['../feedback.js', 'text/javascript; charset=utf-8'],
    '/feedbackPanel.js': ['../feedbackPanel.js', 'text/javascript; charset=utf-8'],
};

const receiver = spawn(process.execPath, [path.join(__dirname, 'receiver.js')],
    { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
receiver.on('exit', code => process.exit(code ?? 1));
process.on('exit', () => receiver.kill());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

receiver.stdout.once('data', line => {   // "feedback receiver on http://127.0.0.1:<port>/, storing in <dir>"
    const receiverPort = /:(\d+)\//.exec(line)[1];
    http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://demo/').pathname;
        if (pathname === '/feedback') {
            const pass = http.request({ host: '127.0.0.1', port: receiverPort, path: '/', method: req.method, headers: req.headers },
                answer => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
            pass.on('error', () => res.writeHead(502).end());
            return req.pipe(pass);
        }
        const file = req.method === 'GET' && files[pathname];
        if (!file) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }).end(fs.readFileSync(path.join(__dirname, file[0])));
    }).listen(Number(process.env.PORT || 8000), '127.0.0.1', function () {
        console.log(`demo on http://127.0.0.1:${this.address().port}/, reports stored in ${process.env.FEEDBACK_DIR}`);
    });
});
