/*
 * Playwright globalSetup for the Firefox project: a virtual X display of its own (Xvfb), so Firefox
 * runs with a screen to capture and never opens a window on the desktop of the machine running the
 * tests. Its number goes to the workers in FEEDBACK_FIREFOX_DISPLAY; without Playwright's Firefox or
 * Xvfb the reason goes in FEEDBACK_FIREFOX_SKIP and firefox.spec.js is skipped with it.
 */
'use strict';
const {spawn, spawnSync} = require('child_process');
const fs = require('fs');

module.exports = async function firefoxDisplay() {
    let executable = '';
    try { executable = require('@playwright/test').firefox.executablePath(); } catch {}
    if (!executable || !fs.existsSync(executable)) {
        process.env.FEEDBACK_FIREFOX_SKIP = "Playwright's Firefox is not installed (npx playwright install firefox)";
        return;
    }
    if (spawnSync('Xvfb', ['-help'], {stdio: 'ignore'}).error) {
        process.env.FEEDBACK_FIREFOX_SKIP = 'Xvfb is not installed: Firefox captures only a real X display';
        return;
    }
    // -displayfd: Xvfb picks a free display number and writes it on fd 3 once it is ready
    const xvfb = spawn('Xvfb', ['-displayfd', '3', '-ac', '-nolisten', 'tcp', '-screen', '0', '1280x800x24'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe']});
    const display = await new Promise((resolve, reject) => {
        let out = '';
        xvfb.stdio[3].on('data', d => { out += d; if (/\n/.test(out)) resolve(':' + out.trim()); });
        xvfb.on('exit', code => reject(new Error(`Xvfb exited (${code})`)));
        setTimeout(() => reject(new Error('Xvfb did not start within 10 s')), 10000);
    }).catch(e => { process.env.FEEDBACK_FIREFOX_SKIP = String(e.message); return ''; });
    if (!display) return;
    process.env.FEEDBACK_FIREFOX_DISPLAY = display;
    return () => xvfb.kill();
};
