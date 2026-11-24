// The widget's own tests. README.md, Running the tests, says how to run them.
'use strict';
const {defineConfig} = require('@playwright/test');

// Firefox captures whatever its picker would offer; with the permission prompt off it takes the screen
// at once. FEEDBACK_FIREFOX_DISPLAY is the Xvfb display firefoxDisplay.js started for it.
const FIREFOX_PREFS = {
    'media.navigator.permission.disabled': true
};

module.exports = defineConfig({
    testDir: __dirname,
    testMatch: '*.spec.js',
    // one receiver on a free port (its address in FEEDBACK_BASE), and Firefox's virtual display
    globalSetup: [require.resolve('./receiver.js'), require.resolve('./firefoxDisplay.js')],
    outputDir: 'test-results',
    fullyParallel: true,
    retries: 0,
    timeout: 30000,
    reporter: [['list']],
    projects: [
        {
            name: 'chrome',
            testIgnore: 'firefox.spec.js',
            use: {
                // FEEDBACK_TEST_CHANNEL=chrome runs the installed Google Chrome; unset, Playwright's own Chromium
                channel: process.env.FEEDBACK_TEST_CHANNEL || undefined,
                headless: !process.env.FEEDBACK_HEADED,
                launchOptions: {
                    // Screen capture without a person: the browser's prompt is accepted and this tab chosen
                    args: ['--use-fake-ui-for-media-stream', '--auto-accept-this-tab-capture', '--window-size=1280,800']
                }
            }
        },
        {
            // only what differs there: a browser that captures but cannot promise this tab
            name: 'firefox',
            testMatch: 'firefox.spec.js',
            use: {
                browserName: 'firefox',
                headless: false, // on its own virtual display, so the page itself is on the screen captured
                viewport: {width: 1200, height: 700},
                launchOptions: {
                    firefoxUserPrefs: FIREFOX_PREFS,
                    env: Object.assign({}, process.env, {DISPLAY: process.env.FEEDBACK_FIREFOX_DISPLAY || '', GDK_BACKEND: 'x11', WAYLAND_DISPLAY: ''})
                }
            }
        }
    ]
});
