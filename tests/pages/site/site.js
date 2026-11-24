// The test site's own script, after the stub: configures the widget from what the test put in
// sessionStorage under feedback.test ({inbox, init}), so each test has its own receiver inbox.
(() => {
    let settings = {};
    try { settings = JSON.parse(sessionStorage.getItem('feedback.test') || '{}'); } catch {}
    window.feedback.init(Object.assign({endpoint: '/receive/' + (settings.inbox || 'site')}, settings.init || {}));
})();
