/*! feedback 1.2.0 panel: the form, screen capture, the report and the request.
 *
 * feedback.js fetches this file on the first press and hands it the raw settings and the error
 * buffer. It validates every setting the stub did not (one console warning per bad key, the
 * default used), draws the dialog in a shadow root styled by adopted stylesheets, builds the
 * report (scrubbed and capped before the preview is drawn, so the preview is what is sent), posts
 * it as multipart/form-data and reads the answer by the protocol's table. docs/ is the reference
 * for the settings (settings.md), the labels (appearance.md) and the protocol (protocol.md).
 */
(() => {
    'use strict';
    const VERSION = '1.2.0';
    const SCHEMA_VERSION = 1;
    const REPORT_MAX_BYTES = 262144;
    const DRAFT_KEY = 'feedback.draft';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const RECORDING_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4'];
    // a screenshot's longest side and size: under any receiver's 8,192 pixels and 5 MB with room to spare
    const SHOT_MAX_SIDE = 3840;
    const SHOT_MAX_BYTES = 4 << 20;

    const hub = window[Symbol.for('feedback.stub')];
    if (!hub) {
        console.error('feedback: feedbackPanel.js is loaded by feedback.js, not on its own');
        return;
    }

    // English defaults for every word the widget shows. The labels setting replaces any of them.
    const LABELS = {
        launcher: 'Feedback',
        title: 'Send feedback',
        typeLegend: 'Type of feedback',
        typeBug: 'Bug',
        typeFeature: 'Feature request',
        typeMessage: 'Message',
        messageLabel: 'Your message',
        charactersLeft: '{n} characters left',
        screenshot: 'Screenshot',
        record: 'Record screen',
        recordNote: 'A recording stops if this page reloads or you leave it.',
        recordNoteFollows: 'The recording follows you from page to page on this site. It stops if you leave the site.',
        recordingLeft: 'The recording stopped because the next page is on another site. That page opens when you send or close this.',
        recordingBlocked: 'The recording stopped because this site does not let the next page be shown in a frame. That page opens when you send or close this.',
        screenshotCaption: 'Screenshot of this tab',
        recordingCaption: 'Recording, {duration}',
        remove: 'Remove',
        recording: 'Recording',
        stop: 'Stop',
        onlyThisTab: 'Only this tab can be captured. Choose this tab when the browser asks.',
        anySurfaceNote: 'This browser shares a whole window or screen, not only this page. Check the preview before you send.',
        captureFailed: 'The screen could not be captured.',
        recordingTimeLimit: 'The recording stopped at its time limit.',
        recordingSizeLimit: 'The recording stopped at its size limit.',
        alsoSent: 'Also sent: {list}.',
        sentAddress: 'this page\'s address',
        sentBrowser: 'your browser',
        sentErrorsOne: '{n} console error',
        sentErrorsOther: '{n} console errors',
        sentRequestsOne: '{n} recent request',
        sentRequestsOther: '{n} recent requests',
        sentFields: 'Sent with it, as form fields: {list}.',
        sentPagesOne: '{n} page visited',
        sentPagesOther: '{n} pages visited',
        sentUser: 'your name as this page knows it',
        sentContext: 'details this site adds',
        showReport: 'Show exactly what is sent',
        hideReport: 'Hide what is sent',
        cancel: 'Cancel',
        send: 'Send',
        sending: 'Sending…',
        retry: 'Retry',
        close: 'Close',
        sent: 'Sent.',
        sentWithId: 'Sent, #{id}',
        thanks: 'Thank you. Your report was sent.',
        failed: 'It could not be sent. Check your connection, then retry.',
        invalid: 'The report was refused. Check it, then send again.',
        outdated: 'This page is out of date. Reload it, then send again. Your message is kept.',
        signIn: 'Sign in again, then send. Your message is kept.',
        tooLarge: 'The report is too large to send.',
        unsupportedMedia: 'An attachment is a kind of file that cannot be received.',
        sendWithoutScreenshot: 'Send without the screenshot',
        sendWithoutRecording: 'Send without the recording',
        rateLimited: 'Too many reports were sent. Try again later.',
        rateLimitedUntil: 'Too many reports were sent. Try again after {time}.',
        disabled: 'Feedback cannot be received at the moment. Your message is kept; try again later.',
        refused: 'The report was refused ({status}).'
    };

    // ---- Settings -------------------------------------------------------------------------------

    const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
    /** A property of an object the page or a receiver gave, never one inherited from a polluted prototype. */
    const ownValue = (o, k) => hasOwn(o, k) ? o[k] : undefined;
    const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    const utf8Bytes = s => new TextEncoder().encode(s).length;
    const text = (max, allowEmpty = true) => v => typeof v === 'string' && v.length <= max && (allowEmpty || v) ? v : undefined;
    const integer = (min, max) => v => Number.isInteger(v) && v >= min && v <= max ? v : undefined;
    const oneOf = (...list) => v => list.includes(v) ? v : undefined;
    const boolean = v => typeof v === 'boolean' ? v : undefined;
    const hook = v => v === null || typeof v === 'function' ? v : undefined;
    const textMap = v => isObject(v) && Object.values(v).every(x => typeof x === 'string') ? Object.assign({}, v) : undefined;
    const snapshot = v => JSON.parse(JSON.stringify(v)); // JSON.stringify once: getters run once, functions drop

    const userValue = v => {
        if (v === null) return null;
        if (!isObject(v)) return undefined;
        let copy;
        try { copy = snapshot(v); } catch { return undefined; }
        const out = {};
        for (const k of ['id', 'name']) {
            const x = ownValue(copy, k);
            if (typeof x === 'number' && Number.isFinite(x)) out[k] = x;
            else if (typeof x === 'string' && x) out[k] = x.slice(0, 200);
        }
        return hasOwn(out, 'id') || hasOwn(out, 'name') ? out : undefined;
    };
    // Levels below the value itself; the report around context adds one, and the whole stays within 16
    const depth = v => v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depth)) : 0;
    const contextValue = v => {
        if (!isObject(v)) return undefined;
        try {
            const json = JSON.stringify(v);
            if (utf8Bytes(json) > 16384) return undefined;
            const copy = JSON.parse(json);
            return depth(copy) <= 15 ? copy : undefined;
        } catch { return undefined; }
    };
    const fieldsValue = v => {
        const map = isObject(v) ? Object.assign({}, v) : undefined;
        if (!map) return undefined;
        for (const [k, x] of Object.entries(map)) {
            if (['report', 'screenshot', 'video'].includes(k)) return undefined;
            if (typeof x === 'number' || typeof x === 'boolean') map[k] = String(x);
            else if (typeof x !== 'string') return undefined;
        }
        return map;
    };
    const typesValue = v => Array.isArray(v) && v.length >= 1 && v.length <= 10 && new Set(v).size === v.length &&
        v.every(t => typeof t === 'string' && /^[a-z][A-Za-z0-9-]{0,19}$/.test(t)) ? v.slice() : undefined;
    const localeValue = v => {
        if (v === '') return '';
        if (typeof v !== 'string') return undefined;
        try { return Intl.getCanonicalLocales(v)[0]; } catch { return undefined; }
    };
    const patternsValue = v => {
        if (!Array.isArray(v)) return undefined;
        try {
            return v.map(p => {
                if (p instanceof RegExp) return new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
                if (typeof p === 'string' && p) return new RegExp(p, 'g');
                throw new TypeError();
            });
        } catch { return undefined; }
    };
    const paramsValue = v => Array.isArray(v) && v.every(s => typeof s === 'string' && s) ? v.map(s => s.toLowerCase()) : undefined;

    // [default, check, what a good value is]. The check answers the value to use, or undefined.
    const RULES = {
        project: ['', text(50), 'text of at most 50 characters'],
        environment: ['', text(30), 'text of at most 30 characters'],
        release: ['', text(40), 'text of at most 40 characters'],
        context: [{}, contextValue, 'an object of JSON values, at most 16 KB and 15 levels deep'],
        user: [null, userValue, 'null or {id, name}'],
        credentials: ['same-origin', oneOf('same-origin', 'include', 'omit'), "'same-origin', 'include' or 'omit'"],
        headers: [{}, v => typeof v === 'function' ? v : textMap(v), 'an object of text values, or a function returning one'],
        fields: [{}, fieldsValue, 'an object of text values with no key named report, screenshot or video'],
        timeoutMs: [60000, integer(1000, 600000), 'an integer from 1000 to 600000'],
        types: [['bug', 'feature', 'message'], typesValue, 'a list of 1 to 10 distinct names (a-z first, then letters, digits or -)'],
        defaultType: [null, v => v === null || v === '' ? null : text(20)(v), 'null or one of "types"'],
        messageMaxLength: [5000, integer(1, 20000), 'an integer from 1 to 20000'],
        locale: ['', localeValue, 'a language tag such as en-US, or empty'],
        zIndex: [2147483000, integer(0, 2147483647), 'an integer from 0 to 2147483647'],
        theme: ['auto', oneOf('auto', 'light', 'dark'), "'auto', 'light' or 'dark'"],
        requestCount: [30, integer(1, 100), 'an integer from 1 to 100'],
        scrubParams: [[], paramsValue, 'a list of parameter names (added to the built-in ones)'],
        scrubPatterns: [[], patternsValue, 'a list of regular expressions'],
        screenshot: [true, boolean, 'true or false'],
        anySurface: [true, boolean, 'true or false'],
        beforeSend: [null, hook, 'a function, set through init()'],
        onOpen: [null, hook, 'a function, set through init()'],
        onSent: [null, hook, 'a function, set through init()'],
        onError: [null, hook, 'a function, set through init()']
    };
    const ATTRIBUTE_TEXT = ['project', 'environment', 'release', 'credentials', 'defaultType', 'locale', 'theme'];
    const COLLECT = {errors: true, requests: true, client: true};
    const VIDEO = {
        maxSeconds: [60, integer(1, 600), 'an integer from 1 to 600'],
        frameRate: [5, integer(1, 30), 'an integer from 1 to 30'],
        maxWidth: [1280, integer(320, 3840), 'an integer from 320 to 3840'],
        bitsPerSecond: [250000, integer(50000, 8000000), 'an integer from 50000 to 8000000'],
        maxBytes: [10485760, integer(100000, 104857600), 'an integer from 100000 to 104857600'],
        follow: [true, boolean, 'true or false']
    };
    const NOTHING = Symbol('nothing');

    /** Defaults, then data attributes, then init(); one warning per bad key and its default kept. */
    function resolveSettings(core, warn) {
        const raw = key => {
            if (hasOwn(core.given, key)) return core.given[key];
            if (!hasOwn(core.attrs, key)) return NOTHING;
            const value = core.attrs[key];
            if (ATTRIBUTE_TEXT.includes(key)) return value;
            try { return JSON.parse(value); } catch {
                warn(`data-${kebab(key)} is not valid JSON; the default is used`);
                return NOTHING;
            }
        };
        const settings = Object.create(null);
        for (const [key, [fallback, check, rule]] of Object.entries(RULES)) {
            const value = raw(key);
            const checked = value === NOTHING ? NOTHING : check(value);
            if (checked === undefined) {
                warn(`"${key}" must be ${rule}; ${key === 'context' ? 'it is left out of the report' : 'the default is used'}`);
            }
            settings[key] = checked === NOTHING || checked === undefined ? fallback : checked;
        }
        if (settings.defaultType !== null && !settings.types.includes(settings.defaultType)) {
            warn('"defaultType" must be null or one of "types"; the default is used');
            settings.defaultType = null;
        }

        settings.collect = Object.assign({}, COLLECT);
        const collect = raw('collect');
        if (collect !== NOTHING) {
            if (!isObject(collect)) warn('"collect" must be an object of errors, requests and client; the default is used');
            else for (const [k, v] of Object.entries(collect)) {
                if (!hasOwn(COLLECT, k)) warn(`"collect.${k}" is not a setting`);
                else if (typeof v !== 'boolean') warn(`"collect.${k}" must be true or false; the default is used`);
                else settings.collect[k] = v;
            }
        }

        const video = raw('video');
        settings.video = Object.fromEntries(Object.entries(VIDEO).map(([k, [d]]) => [k, d]));
        if (video === false) settings.video = false;
        else if (video !== NOTHING && video !== true) {
            if (!isObject(video)) warn('"video" must be false or an object; the default is used');
            else for (const [k, v] of Object.entries(video)) {
                if (!hasOwn(VIDEO, k)) warn(`"video.${k}" is not a setting`);
                else if (VIDEO[k][1](v) === undefined) warn(`"video.${k}" must be ${VIDEO[k][2]}; the default is used`);
                else settings.video[k] = v;
            }
        }

        settings.labels = Object.assign(Object.create(null), LABELS);
        const typeKeys = settings.types.map(typeLabelKey);
        const labels = raw('labels');
        if (labels !== NOTHING) {
            if (!isObject(labels)) warn('"labels" must be an object of text; the default is used');
            else for (const [k, v] of Object.entries(labels)) {
                if (!hasOwn(LABELS, k) && !typeKeys.includes(k)) warn(`"labels.${k}" is not a label`);
                else if (typeof v !== 'string' || v.length > 300) warn(`"labels.${k}" must be text of at most 300 characters`);
                else settings.labels[k] = v;
            }
        }
        for (const k of ['endpoint', 'trigger', 'panelSrc', 'panelIntegrity']) settings[k] = core.own[k];
        return settings;
    }
    const typeLabelKey = t => 'type' + t[0].toUpperCase() + t.slice(1);

    // ---- Scrubbing ------------------------------------------------------------------------------

    // The names whose values are blanked, always; a host's scrubParams adds to them
    const SCRUB_NAMES = ['token', 'key', 'secret', 'password', 'code', 'signature', 'auth', 'apikey', 'api_key', 'access_token',
        'sid', 'sessionid', 'jsessionid', 'phpsessid', 'session', 'pwd', 'pass', 'sig', 'jwt', 'otp', 'authorization'];

    /**
     * Blanks what looks secret, before the preview is drawn. A value is cut to 8,000 characters first and
     * every pattern has bounded repeats, so a page's longest address costs a few milliseconds at most.
     */
    function makeScrubber(params, patterns) {
        const secret = new Set(SCRUB_NAMES.concat(params));
        const isSecretName = name => {
            let n = name;
            try { n = decodeURIComponent(name.replace(/\+/g, ' ')); } catch {}
            n = n.trim();
            if (secret.has(n.toLowerCase())) return true;
            // access_token, apiKey and X-Amz-Signature match by a whole word; barcode does not match code
            return n.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).some(w => w && secret.has(w.toLowerCase()));
        };
        const bound = s => s.length > 8000 ? cut(s, 8000) : s;
        // name=value in a query or a fragment; a value runs to the next & # or ? (so ?next=/cb?token=x is two)
        const scrubQuery = s => s.replace(/([^?&#;=/]{1,100})=([^&#?]*)/g, (m, k, v) => v && isSecretName(k) ? k + '=…' : m);
        const scrubUrlParts = value => {
            let url;
            try { url = new URL(value); } catch { return value; }
            if (!url.host) return value;
            const auth = url.username || url.password ? '…@' : '';
            return url.protocol + '//' + auth + url.host + url.pathname + scrubQuery(url.search) + scrubQuery(url.hash);
        };
        const builtIn = [
            [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]{1,4000}=*/gi, '$1 …'],
            [/eyJ[A-Za-z0-9_-]{2,4000}\.[A-Za-z0-9_-]{2,4000}\.?[A-Za-z0-9_-]{0,4000}/g, '…'],
            // "name": "value" in JSON (an object a page logged), and name=value anywhere (a relative address, a body)
            [/"([^"\\]{1,100})"\s*:\s*("(?:[^"\\]|\\.){0,4000}"|-?\d[\d.eE+-]{0,40})/g, (m, k) => isSecretName(k) ? `"${k}":"…"` : m],
            [/(^|[^\w.%-])([A-Za-z_%][\w.%-]{0,60})=([^\s&;,#?"'<>(){}[\]]{1,4000})/g, (m, before, k) => isSecretName(k) ? `${before}${k}=…` : m],
            [/\d{1,60}(?:(?:[ \u00A0]{1,2}|[.-])\d{1,60}){0,30}/g, cards]
        ];
        const applyPatterns = s => {
            for (const [re, to] of builtIn) s = s.replace(re, to);
            for (const re of patterns) s = s.replace(re, '…');
            return s;
        };
        return {
            url: value => value ? applyPatterns(scrubUrlParts(bound(String(value)))) : value,
            text: value => value ? applyPatterns(bound(String(value)).replace(/\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s"'<>()]{1,4000}/gi, scrubUrlParts)) : value
        };
    }
    /**
     * A run of digits in groups (spaces, a no-break space, dots or hyphens between) holding 13 to 19 digits
     * that pass the Luhn check, as a card number does, is blanked: any span of whole groups, or any stretch
     * of one long group, so a card beside other digits is still found.
     */
    function cards(run) {
        const groups = [];
        run.replace(/\d+/g, (g, at) => { groups.push({at, end: at + g.length, digits: g}); return g; });
        if (groups.reduce((n, g) => n + g.digits.length, 0) < 13) return run;
        for (let first = 0; first < groups.length; first++) {
            let digits = '';
            for (let last = first; last < groups.length && digits.length < 19; last++) {
                digits += groups[last].digits;
                if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
                    return run.slice(0, groups[first].at) + '…' + cards(run.slice(groups[last].end));
                }
            }
            const g = groups[first].digits;
            if (g.length > 19 && g.length <= 60) {
                for (let length = 19; length >= 13; length--) {
                    for (let i = 0; i + length <= g.length; i++) {
                        if (luhn(g.slice(i, i + length))) return run.slice(0, groups[first].at + i) + '…' + cards(run.slice(groups[first].at + i + length));
                    }
                }
            }
        }
        return run;
    }
    function luhn(digits) {
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
            let d = Number(digits[digits.length - 1 - i]);
            if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
            sum += d;
        }
        return sum % 10 === 0;
    }

    // ---- Styles ---------------------------------------------------------------------------------

    const CSS = `
:host { all: initial; position: fixed; inset: 0; pointer-events: none;
  --fb-accent: var(--feedback-accent, #2563eb);
  --fb-surface: var(--feedback-surface, #ffffff); --fb-text: var(--feedback-text, #1f2328);
  --fb-danger: #b42318; --fb-backdrop: rgb(0 0 0 / 0.4);
  --fb-radius: var(--feedback-radius, 12px);
  --fb-font: var(--feedback-font, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  color-scheme: light; }
:host([data-theme="dark"]) { --fb-surface: var(--feedback-surface, #1c1c1f); --fb-text: var(--feedback-text, #ececee);
  --fb-danger: #ff9b8f; --fb-backdrop: rgb(0 0 0 / 0.6); color-scheme: dark; }
@media (prefers-color-scheme: dark) {
  :host([data-theme="auto"]) { --fb-surface: var(--feedback-surface, #1c1c1f); --fb-text: var(--feedback-text, #ececee);
    --fb-danger: #ff9b8f; --fb-backdrop: rgb(0 0 0 / 0.6); color-scheme: dark; }
}
:host([hidden]), [hidden] { display: none !important; }
*, *::before, *::after { box-sizing: border-box; }
.root { font: 14px/1.45 var(--fb-font); color: var(--fb-text);
  /* text on the accent: the host's choice, else the more readable of near-black and white (set on open) */
  --fb-on-accent: var(--feedback-accent-text, var(--fb-auto-on-accent, #ffffff));
  --fb-muted: color-mix(in srgb, var(--fb-text) 72%, var(--fb-surface));
  --fb-line: color-mix(in srgb, var(--fb-text) 52%, var(--fb-surface));
  --fb-soft: color-mix(in srgb, var(--fb-text) 7%, var(--fb-surface)); }
.backdrop { position: fixed; inset: 0; background: var(--fb-backdrop); pointer-events: auto; }
.card { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow: hidden;
  display: flex; flex-direction: column;
  background: var(--fb-surface); color: var(--fb-text); border-radius: var(--fb-radius);
  box-shadow: 0 16px 48px rgb(0 0 0 / 0.22), 0 0 0 1px rgb(0 0 0 / 0.06); pointer-events: auto;
  animation: fb-in 140ms ease-out; }
@keyframes fb-in { from { opacity: 0; } to { opacity: 1; } }
@media (max-width: 480px) {
  .card { left: 0; right: 0; top: auto; bottom: 0; transform: none; width: 100%;
    max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px);
    border-radius: var(--fb-radius) var(--fb-radius) 0 0; }
  .card > h2 { padding: 18px 16px 4px; }
  .scroll { padding: 12px 16px 16px; }
  .actions { padding: 12px 16px calc(16px + env(safe-area-inset-bottom)); }
  .actions .btn { flex: 1; }
}
h2 { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; }
/* The title and the actions stay in view; the middle scrolls when the card meets the window's height */
.card > h2 { flex: none; padding: 20px 24px 4px; }
form, .done { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; margin: 0; }
.scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-block: 12px;
  display: flex; flex-direction: column; gap: 16px; padding: 12px 24px 16px; }
.field { display: flex; flex-direction: column; gap: 6px; }
label { font-weight: 600; }
button { font: inherit; color: inherit; cursor: pointer; }
button:disabled { cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--fb-accent); outline-offset: 2px; }
/* an accent under 3:1 against the surface: rings in the text color, accent fills get an edge */
.root.low-accent :focus-visible { outline-color: var(--fb-text); }
.root.low-accent .segmented button[aria-checked="true"], .root.low-accent .btn.primary { box-shadow: inset 0 0 0 1px var(--fb-line); }
.probe { color: var(--fb-accent); background: var(--fb-surface); }
.segmented { display: flex; gap: 4px; padding: 3px; border: 1px solid var(--fb-line); border-radius: 10px; }
.segmented button { flex: 1 1 0; min-width: 0; min-height: 36px; padding: 4px 8px; border: 0; border-radius: 7px;
  background: transparent; font-weight: 600; line-height: 1.2; }
.segmented button:hover { background: var(--fb-soft); }
.segmented button[aria-checked="true"] { background: var(--fb-accent); color: var(--fb-on-accent); }
textarea { width: 100%; min-height: 132px; resize: vertical; padding: 10px 12px; font: 15px/1.45 var(--fb-font);
  color: var(--fb-text); background: var(--fb-surface); border: 1px solid var(--fb-line); border-radius: 8px; }
textarea:focus-visible { outline-offset: 0; }
.counter { align-self: flex-end; font-size: 13px; color: var(--fb-muted); }
.counter.full { color: var(--fb-danger); }
.attach { display: flex; flex-wrap: wrap; gap: 8px; }
.note { margin: 0; font-size: 13px; color: var(--fb-muted); }
.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 40px; padding: 0 16px;
  border: 1px solid var(--fb-line); border-radius: 8px; background: transparent; font-weight: 600; white-space: nowrap; }
.btn.small { min-height: 34px; padding: 0 12px; }
.btn:hover:not(:disabled) { background: var(--fb-soft); }
.btn.primary { background: var(--fb-accent); border-color: var(--fb-accent); color: var(--fb-on-accent); }
.btn.primary:hover:not(:disabled) { background: var(--fb-accent); filter: brightness(1.08); }
.btn:disabled { opacity: 0.5; }
@media (pointer: coarse) { .btn, .segmented button { min-height: 44px; } }
.media { display: flex; flex-direction: column; gap: 10px; }
.media:empty { display: none; }
.item { display: flex; gap: 12px; align-items: center; padding: 8px; border: 1px solid var(--fb-line); border-radius: 10px; }
.item img { width: 112px; height: 70px; object-fit: contain; border-radius: 6px; background: var(--fb-soft); flex: none; }
.item.video { flex-direction: column; align-items: stretch; }
.item video { width: 100%; max-height: 180px; border-radius: 6px; background: #000; }
.item .meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 1; min-width: 0; }
.item .caption { flex: 1; font-size: 13px; color: var(--fb-muted); }
.sent-line, .fields-line { margin: 0; font-size: 13px; color: var(--fb-muted); }
.link { padding: 0; border: 0; background: none; font-size: 13px; color: var(--fb-text); text-decoration: underline;
  text-underline-offset: 2px; text-align: start; align-self: flex-start; }
pre { margin: 0; max-height: 220px; overflow: auto; padding: 10px 12px; border-radius: 8px; background: var(--fb-soft);
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.alert { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; color: var(--fb-danger); }
.alert:empty { display: none; }
.alert p { margin: 0; }
.alert .btn { color: var(--fb-text); }
.actions { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 24px 20px; border-top: 1px solid transparent; }
.card.overflowing .actions { border-top-color: color-mix(in srgb, var(--fb-text) 14%, var(--fb-surface)); }
.done .scroll { gap: 8px; }
.done p { margin: 0; }
.done .headline { font-size: 16px; font-weight: 600; }
.pill { position: fixed; bottom: 16px; inset-inline-end: 16px; display: flex; align-items: center; gap: 10px;
  padding: 6px 6px 6px 14px; border-radius: 999px; background: var(--fb-surface); color: var(--fb-text);
  box-shadow: 0 6px 24px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(0 0 0 / 0.08); pointer-events: auto; font-variant-numeric: tabular-nums; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #d92d20; animation: fb-pulse 1.2s ease-in-out infinite; }
@keyframes fb-pulse { 50% { opacity: 0.35; } }
.nudge { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0.02; background: #000; pointer-events: none; }
.nudge.flip { background: #fff; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

    // ---- Helpers --------------------------------------------------------------------------------

    function h(tag, attributes, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attributes || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : String(v));
        }
        el.append(...children);
        return el;
    }
    const fill = (template, values) => template.replace(/\{(\w+)\}/g, (m, k) => hasOwn(values, k) ? values[k] : m);
    const iso = ms => new Date(ms).toISOString();
    // a cut never leaves half a character, and nothing sent carries a lone surrogate (a JSON parser may refuse it)
    const cut = (s, n) => typeof s === 'string' ? s.slice(0, n).replace(/[\uD800-\uDBFF]$/, '') : s;
    const wellFormed = s => typeof s.toWellFormed === 'function' ? s.toWellFormed()
        : s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
    const wellFormedValue = v => typeof v === 'string' ? wellFormed(v) : Array.isArray(v) ? v.map(wellFormedValue)
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [wellFormed(k), wellFormedValue(x)])) : v;
    const clock = ms => {
        const s = Math.max(0, Math.floor(ms / 1000));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };
    const uuid = () => {
        if (crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = b[6] & 0x0f | 0x40;
        b[8] = b[8] & 0x3f | 0x80;
        const x = [...b].map(n => n.toString(16).padStart(2, '0')).join('');
        return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
    };
    function direction(locale) {
        try {
            const l = new Intl.Locale(locale);
            const info = typeof l.getTextInfo === 'function' ? l.getTextInfo() : l.textInfo;
            if (info && info.direction) return info.direction;
        } catch {}
        return /^(ar|dv|fa|he|iw|ks|ps|sd|ug|ur|yi)\b/i.test(locale) ? 'rtl' : 'ltr';
    }
    /** document.title and the like from the Document prototype, so <img name="title"> cannot answer instead. */
    const documentText = name => {
        try {
            const value = Object.getOwnPropertyDescriptor(Document.prototype, name).get.call(document);
            return typeof value === 'string' ? value : '';
        } catch { return ''; }
    };
    const EXTENSIONS = {'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'video/webm': 'webm', 'video/mp4': 'mp4'};
    const extension = type => ownValue(EXTENSIONS, type) || 'bin';

    /**
     * A MediaRecorder WebM is written as a live stream: its Segment has no size and its Info no Duration
     * (Chrome) or a Duration of 0 (Firefox), so a player shows no length and cannot seek until it has
     * played it through. This writes the length (ms) into Info and changes nothing else: a Duration of 0
     * is overwritten in place at its own size; with none, an 8-byte Duration is added and Info's size
     * rewritten as an 8-byte number. Only the first 64 KB are read; a file not of exactly that shape (an
     * EBML header, a Segment of unknown size, a sized Info before the first Cluster, no Duration or a
     * Duration of 0) comes back as it was.
     */
    async function webmWithDuration(blob, ms) {
        try {
            const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
            let pos = 0;
            const number = keepMarker => { // an EBML variable-length integer
                const first = head[pos];
                let length = 1;
                while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
                if (length > 8 || pos + length > head.length) throw new RangeError('not EBML');
                let value = keepMarker ? first : first & (0xff >> length);
                let ones = (first & (0xff >> length)) === (0xff >> length);
                for (let i = 1; i < length; i++) {
                    value = value * 256 + head[pos + i];
                    ones = ones && head[pos + i] === 0xff;
                }
                pos += length;
                return {value, unknown: !keepMarker && ones};
            };
            const element = () => {
                const id = number(true).value;
                const sizeAt = pos;
                const size = number(false);
                return {id, sizeAt, size, body: pos, end: pos + size.value};
            };
            const ebml = element();
            if (ebml.id !== 0x1a45dfa3 || ebml.size.unknown) return blob;
            pos = ebml.end;
            const segment = element();
            if (segment.id !== 0x18538067 || !segment.size.unknown) return blob;
            while (pos < head.length - 12) {
                const e = element();
                if (e.id === 0x1f43b675 || e.size.unknown) return blob; // a Cluster, or anything unsized, before Info
                if (e.id !== 0x1549a966) {
                    pos = e.end;
                    continue;
                }
                if (e.end > head.length) return blob;
                let scale = 1000000; // TimestampScale, in nanoseconds
                let zero = null; // a Duration of 0, as Firefox writes it
                while (pos < e.end) {
                    const c = element();
                    if (c.id === 0x4489) {
                        const view = new DataView(head.buffer, c.body, c.size.value);
                        const value = c.size.value === 8 ? view.getFloat64(0) : c.size.value === 4 ? view.getFloat32(0) : NaN;
                        if (value !== 0) return blob; // a length already, or a Duration not of a float's size
                        zero = c;
                    }
                    if (c.id === 0x2ad7b1) {
                        scale = 0;
                        for (let i = 0; i < c.size.value; i++) scale = scale * 256 + head[c.body + i];
                    }
                    pos = c.end;
                }
                if (pos !== e.end || !scale) return blob;
                if (zero) {
                    const value = new Uint8Array(zero.size.value);
                    const view = new DataView(value.buffer);
                    if (zero.size.value === 8) view.setFloat64(0, ms * 1000000 / scale);
                    else view.setFloat32(0, ms * 1000000 / scale);
                    return new Blob([head.subarray(0, zero.body), value, blob.slice(zero.end)], {type: blob.type});
                }
                const size = new Uint8Array(8); // Info's new size, as an 8-byte number
                size[0] = 0x01;
                for (let i = 7, n = e.size.value + 11; i >= 1; i--, n = Math.floor(n / 256)) size[i] = n % 256;
                const duration = new Uint8Array(11);
                duration.set([0x44, 0x89, 0x88]);
                new DataView(duration.buffer).setFloat64(3, ms * 1000000 / scale);
                return new Blob([head.subarray(0, e.sizeAt), size, head.subarray(e.body, e.end), duration, blob.slice(e.end)], {type: blob.type});
            }
        } catch {}
        return blob;
    }

    /** Any CSS color, as the browser resolves it, to [r, g, b] through a one-pixel canvas. */
    function toRgb(color) {
        try {
            const ctx = document.createElement('canvas').getContext('2d', {willReadFrequently: true});
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        } catch { return null; }
    }
    function contrast(a, b) {
        const lum = c => {
            const [r, g, b2] = c.map(v => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
        };
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    }

    // ---- The panel ------------------------------------------------------------------------------

    function createPanel(core) {
        const say = core.say;
        const warn = m => say('warn', m);
        const cfg = resolveSettings(core, warn);
        const L = cfg.labels;
        const locale = cfg.locale || document.documentElement.lang || navigator.language || 'en';
        const dir = direction(locale);
        const scrub = makeScrubber(cfg.scrubParams, cfg.scrubPatterns);
        /**
         * How a capture can be taken, asked afresh each time and never by the browser's name: 'tab' where the
         * browser can capture a tab and say which surface it got (this tab only, anything else thrown away);
         * 'any' where it can capture but cannot promise a tab, and anySurface allows whatever its picker
         * offers; '' where it cannot capture at all. A browser that starts reporting a tab surface takes the
         * strict path by itself.
         */
        function captureMode() {
            const md = navigator.mediaDevices;
            if (!md || typeof md.getDisplayMedia !== 'function') return '';
            let tab = false;
            try { tab = typeof md.getSupportedConstraints === 'function' && !!md.getSupportedConstraints().displaySurface; } catch {}
            return tab ? 'tab' : cfg.anySurface ? 'any' : '';
        }
        const canRecord = () => !!captureMode() && typeof MediaRecorder === 'function' && RECORDING_TYPES.some(t => MediaRecorder.isTypeSupported(t));
        const context = {user: cfg.user, context: cfg.context};

        const state = {
            id: null, openedAt: 0, owner: null, type: null, message: '',
            screenshot: null, video: null, recording: null,
            busy: false, done: null, failed: false, offer: null, alert: '', notice: '', finishing: null, closeAfterStop: false
        };
        let mode = 'closed', opener = null, ui = null, previewOpen = false, previewQueued = false, generation = 0, previewTimer = 0;
        let focusGuarded = false, refocusing = false, layer = null;
        for (const k of ['user', 'context']) if (hasOwn(core.pending, k)) setContext(k, core.pending[k]);

        // Draft: the message and type survive a reload; never the attachments
        const userKey = () => context.user && context.user.id !== undefined ? String(context.user.id) : null;
        const readDraft = () => {
            try {
                const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
                if (!isObject(stored)) return null;
                const d = Object.create(null); // what was stored, never what a polluted prototype adds
                for (const k of ['user', 'id', 'openedAt', 'type', 'message']) if (hasOwn(stored, k)) d[k] = stored[k];
                if ((d.user === undefined ? null : d.user) !== userKey()) {
                    sessionStorage.removeItem(DRAFT_KEY);
                    return null;
                }
                return d;
            } catch { return null; }
        };
        const writeDraft = () => {
            try {
                sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
                    user: userKey(), id: state.id, openedAt: state.openedAt, type: state.type, message: state.message
                }));
            } catch {}
        };
        const dropDraft = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch {} };

        function begin() {
            const d = readDraft();
            state.owner = userKey();
            state.id = d && UUID.test(d.id) ? d.id : uuid();
            state.openedAt = d && Number.isFinite(d.openedAt) ? d.openedAt : Date.now();
            state.type = d && cfg.types.includes(d.type) ? d.type : cfg.types.length === 1 ? cfg.types[0] : cfg.defaultType;
            state.message = d && typeof d.message === 'string' ? d.message.slice(0, cfg.messageMaxLength) : '';
            state.failed = false;
            state.offer = null;
            state.alert = state.notice = '';
        }
        function discard() {
            stopRecording(true);
            state.finishing = null;
            for (const k of ['screenshot', 'video']) removeAttachment(k, true);
            Object.assign(state, {id: null, type: null, message: '', busy: false, done: null, failed: false, offer: null, alert: '', notice: ''});
        }

        // ---- Building the dialog

        function build() {
            const host = h('div', {'data-feedback-panel': true, 'data-theme': cfg.theme, hidden: true});
            host.style.zIndex = String(cfg.zIndex);
            const root = host.attachShadow({mode: 'open'});
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(CSS);
            root.adoptedStyleSheets = [sheet];

            const radios = cfg.types.map(t => h('button', {
                type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-type': t,
                text: L[typeLabelKey(t)] || t, onclick: () => pickType(t)
            }));
            const segmented = h('div', {class: 'segmented', role: 'radiogroup', 'aria-label': L.typeLegend, onkeydown: onRadioKey}, ...radios);
            const textarea = h('textarea', {
                id: 'fb-message', maxlength: cfg.messageMaxLength, 'aria-describedby': 'fb-counter', oninput: onInput
            });
            const counter = h('div', {id: 'fb-counter', class: 'counter', hidden: true});
            const screenshotButton = h('button', {type: 'button', class: 'btn small', text: L.screenshot, onclick: takeScreenshot});
            const recordButton = h('button', {type: 'button', class: 'btn small', text: L.record, 'aria-describedby': 'fb-record-note', onclick: startRecording});
            const recordNote = h('p', {id: 'fb-record-note', class: 'note', text: canKeep() ? L.recordNoteFollows : L.recordNote});
            const surfaceNote = h('p', {id: 'fb-surface-note', class: 'note', text: L.anySurfaceNote, hidden: true});
            const media = h('div', {class: 'media'});
            const sentLine = h('p', {class: 'sent-line', id: 'fb-sent-line'});
            const previewToggle = h('button', {type: 'button', class: 'link', 'aria-expanded': 'false', 'aria-controls': 'fb-preview', text: L.showReport, onclick: togglePreview});
            const preview = h('pre', {id: 'fb-preview', tabindex: '0', hidden: true, 'aria-labelledby': 'fb-sent-line'});
            const fieldsLine = h('p', {class: 'fields-line', hidden: true});
            const alertText = h('p');
            const offerButton = h('button', {type: 'button', class: 'btn small', hidden: true, onclick: sendWithoutOffer});
            const alert = h('div', {class: 'alert', role: 'alert'});
            const notice = h('p', {class: 'note', role: 'status'});
            const cancelButton = h('button', {type: 'button', class: 'btn', text: L.cancel, onclick: () => close()});
            const sendButton = h('button', {type: 'submit', class: 'btn primary', text: L.send});
            const scroll = h('div', {class: 'scroll'},
                segmented,
                h('div', {class: 'field'}, h('label', {for: 'fb-message', text: L.messageLabel}), textarea, counter),
                h('div', {class: 'field'}, h('div', {class: 'attach'}, screenshotButton, recordButton), surfaceNote, recordNote),
                notice, media,
                h('div', {class: 'field'}, sentLine, previewToggle, preview, fieldsLine),
                alert);
            const form = h('form', {novalidate: true, onsubmit: e => { e.preventDefault(); send(); }},
                scroll, h('div', {class: 'actions'}, cancelButton, sendButton));
            const doneHeadline = h('p', {class: 'headline'});
            const doneText = h('p');
            const closeButton = h('button', {type: 'button', class: 'btn primary', text: L.close, onclick: () => close()});
            const done = h('div', {class: 'done', role: 'status', hidden: true},
                h('div', {class: 'scroll'}, doneHeadline, doneText), h('div', {class: 'actions'}, closeButton));
            const card = h('div', {class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fb-title', onkeydown: onCardKey},
                h('h2', {id: 'fb-title', text: L.title}), form, done);
            const backdrop = h('div', {class: 'backdrop', onclick: () => close()});
            const time = h('span', {text: '0:00'});
            const pillStatus = h('span', {class: 'visually-hidden', role: 'status'});
            const stopButton = h('button', {type: 'button', class: 'btn small primary', text: L.stop, onclick: () => stopRecording(false)});
            const pill = h('div', {class: 'pill', role: 'group', 'aria-label': L.recording, hidden: true},
                h('span', {class: 'dot', 'aria-hidden': 'true'}), pillStatus, time, stopButton);
            const nudge = h('div', {class: 'nudge', 'aria-hidden': 'true', hidden: true});
            const probe = h('span', {class: 'probe', 'aria-hidden': 'true', hidden: true});
            const base = h('div', {class: 'root', dir, lang: locale}, backdrop, card, pill, nudge, probe);
            root.append(base);
            (document.body || document.documentElement).append(host);
            new ResizeObserver(markOverflow).observe(card);
            ui = {host, root, base, probe, card, scroll, pillStatus, backdrop, pill, time, stopButton, radios, segmented, textarea, counter, screenshotButton, recordButton,
                recordNote, surfaceNote, media, sentLine, previewToggle, preview, fieldsLine, alert, alertText, offerButton, notice, sendButton, cancelButton,
                form, done, doneHeadline, doneText, closeButton, nudge};
        }

        // ---- Rendering

        function render() {
            if (!ui) return;
            const checked = state.type;
            ui.segmented.hidden = cfg.types.length === 1;
            ui.radios.forEach((r, i) => {
                const on = r.dataset.type === checked;
                r.setAttribute('aria-checked', String(on));
                r.tabIndex = on || (!checked && i === 0) ? 0 : -1;
            });
            if (ui.textarea.value !== state.message) ui.textarea.value = state.message;
            renderCounter();
            const capture = captureMode();
            ui.screenshotButton.hidden = !(cfg.screenshot && capture) || !!state.screenshot;
            ui.recordButton.hidden = !(cfg.video && canRecord()) || !!state.video;
            ui.recordNote.hidden = ui.recordButton.hidden || !L.recordNote;
            // where the picker may offer a window or the screen, the person is told so while a button shows
            ui.surfaceNote.hidden = capture !== 'any' || (ui.screenshotButton.hidden && ui.recordButton.hidden) || !L.anySurfaceNote;
            ui.screenshotButton.parentNode.parentNode.hidden = ui.screenshotButton.hidden && ui.recordButton.hidden;
            renderMedia();
            renderSentLine();
            ui.notice.textContent = state.notice;
            ui.notice.hidden = !state.notice;
            renderAlert();
            renderSend();
            ui.form.hidden = !!state.done;
            ui.done.hidden = !state.done;
            if (state.done) {
                ui.doneHeadline.textContent = state.done.id ? fill(L.sentWithId, {id: state.done.id}) : L.sent;
                ui.doneText.textContent = state.done.message || L.thanks;
            }
            if (previewOpen) queuePreview();
            markOverflow();
        }
        /** A line above the actions only while the middle has more to scroll. */
        function markOverflow() {
            if (!ui) return;
            const scroll = (state.done ? ui.done : ui.form).querySelector('.scroll');
            ui.card.classList.toggle('overflowing', scroll.scrollHeight > scroll.clientHeight + 1);
        }
        function renderCounter() {
            const left = cfg.messageMaxLength - state.message.length;
            const near = state.message.length >= cfg.messageMaxLength * 0.8;
            ui.counter.hidden = !near;
            ui.counter.classList.toggle('full', left <= 0);
            ui.counter.textContent = near ? fill(L.charactersLeft, {n: number(left)}) : '';
        }
        function renderSend() {
            // while sending it stays focusable (aria-disabled, and send() refuses), so focus is never lost
            const ready = !!state.type && state.message.trim() !== '';
            ui.sendButton.disabled = !ready && !state.busy;
            ui.sendButton.setAttribute('aria-disabled', String(state.busy || !ready));
            ui.sendButton.textContent = state.busy ? L.sending : state.failed ? L.retry : L.send;
        }
        function renderAlert() {
            ui.alert.replaceChildren();
            if (state.alert) {
                ui.alertText.textContent = state.alert;
                ui.alert.append(ui.alertText);
            }
            if (state.offer) {
                ui.offerButton.textContent = state.offer === 'video' ? L.sendWithoutRecording : L.sendWithoutScreenshot;
                ui.offerButton.hidden = false;
                ui.offerButton.disabled = state.busy;
                ui.alert.append(ui.offerButton);
            }
        }
        function renderMedia() {
            const items = [];
            if (state.screenshot) {
                const s = state.screenshot;
                if (!s.node) {
                    s.node = h('div', {class: 'item'},
                        h('img', {src: s.url, alt: L.screenshotCaption}),
                        h('div', {class: 'meta'},
                            h('span', {class: 'caption', id: 'fb-shot-caption', text: L.screenshotCaption}),
                            h('button', {type: 'button', class: 'btn small', 'aria-describedby': 'fb-shot-caption', text: L.remove,
                                onclick: () => { removeAttachment('screenshot'); focusFirst(); }})));
                }
                items.push(s.node);
            }
            if (state.video) {
                const v = state.video;
                if (!v.node) {
                    const caption = fill(L.recordingCaption, {duration: clock(v.ms)});
                    v.node = h('div', {class: 'item video'},
                        h('video', {src: v.url, controls: true, preload: 'metadata', playsinline: true, 'aria-label': caption}),
                        h('div', {class: 'meta'},
                            h('span', {class: 'caption', id: 'fb-video-caption', text: caption}),
                            h('button', {type: 'button', class: 'btn small', 'aria-describedby': 'fb-video-caption', text: L.remove,
                                onclick: () => { removeAttachment('video'); focusFirst(); }})));
                }
                items.push(v.node);
            }
            ui.media.replaceChildren(...items);
        }
        function renderSentLine() {
            const parts = [L.sentAddress];
            if (cfg.collect.client) parts.push(L.sentBrowser);
            if (keep.pages.length > 1) parts.push(plural('sentPages', keep.pages.length));
            if (cfg.collect.errors && allErrors().length) parts.push(plural('sentErrors', allErrors().length));
            if (cfg.collect.requests) {
                const n = requestEntries().length;
                if (n) parts.push(plural('sentRequests', n));
            }
            if (context.user) parts.push(L.sentUser);
            if (Object.keys(context.context).length) parts.push(L.sentContext);
            let list;
            try { list = new Intl.ListFormat(locale, {type: 'conjunction'}).format(parts); } catch { list = parts.join(', '); }
            ui.sentLine.textContent = fill(L.alsoSent, {list});
        }
        function plural(base, n) {
            let rule = 'other';
            try { rule = new Intl.PluralRules(locale).select(n); } catch {}
            return fill(L[base + (rule === 'one' ? 'One' : 'Other')], {n: number(n)});
        }
        function number(n) {
            try { return new Intl.NumberFormat(locale).format(n); } catch { return String(n); }
        }
        function togglePreview() {
            previewOpen = !previewOpen;
            ui.preview.hidden = !previewOpen;
            ui.previewToggle.setAttribute('aria-expanded', String(previewOpen));
            ui.previewToggle.textContent = previewOpen ? L.hideReport : L.showReport;
            clearInterval(previewTimer);
            if (previewOpen) {
                drawPreview();
                // drawn again as errors and requests arrive while it is open, so it shows the report as it now is
                let seen = previewSignature();
                previewTimer = setInterval(() => {
                    const now = previewSignature();
                    if (now === seen || mode !== 'dialog') return;
                    seen = now;
                    drawPreview();
                    renderSentLine();
                }, 500);
            } else ui.fieldsLine.hidden = true;
        }
        function previewSignature() {
            const last = core.buffer[core.buffer.length - 1];
            return [core.buffer.length, last ? last.count : 0, performance.getEntriesByType('resource').length, keep.journal.length].join('/');
        }
        function queuePreview() {
            if (previewQueued) return;
            previewQueued = true;
            requestAnimationFrame(() => { previewQueued = false; if (previewOpen) drawPreview(); });
        }
        function drawPreview() {
            ui.preview.textContent = JSON.stringify(buildReport(Date.now()), null, 2);
            const fields = Object.entries(cfg.fields);
            ui.fieldsLine.hidden = !fields.length;
            ui.fieldsLine.textContent = fill(L.sentFields, {list: fields.map(([k, v]) => `${k}=${v}`).join(', ')});
        }

        // ---- Opening, closing, focus

        /** Opens the dialog; quiet when it comes back after a capture, so onOpen is not called again. */
        function open(trigger, quiet) {
            if (!ui) build();
            if (keep.exiting) abandonExit();
            if (trigger) opener = trigger;
            if (mode === 'pill' || mode === 'capturing') return;
            if (state.id && state.owner !== userKey() && !state.done) discard();
            if (!state.id && !state.done) begin();
            mode = 'dialog';
            place('dialog');
            guardFocus(true);
            ui.host.hidden = false;
            tuneAccent();
            ui.backdrop.hidden = ui.card.hidden = false;
            ui.pill.hidden = true;
            ui.pillStatus.textContent = '';
            render();
            focusFirst();
            if (!quiet) callHook('onOpen');
        }
        function close(keepFocusOnPage) {
            if (mode === 'closed') return;
            if (mode === 'pill') {
                state.closeAfterStop = true;
                return stopRecording(false);
            }
            mode = 'closed';
            ui.host.hidden = true;
            place('page');
            guardFocus(false);
            if (state.done) state.done = null;
            if (previewOpen) togglePreview(); // its redrawing stops with it
            if (!keepFocusOnPage) returnFocus();
            keepExit();
        }
        /** Reads the accent as the page resolved it and keeps text on it, and rings beside it, readable. */
        function tuneAccent() {
            const style = getComputedStyle(ui.probe);
            const accent = toRgb(style.color), surface = toRgb(style.backgroundColor);
            if (!accent || !surface) return;
            if (!getComputedStyle(ui.host).getPropertyValue('--feedback-accent-text').trim()) {
                const dark = contrast(accent, [17, 17, 17]) > contrast(accent, [255, 255, 255]);
                ui.base.style.setProperty('--fb-auto-on-accent', dark ? '#111111' : '#ffffff');
            }
            ui.base.classList.toggle('low-accent', contrast(accent, surface) < 3);
        }
        const focusable = el => !!el && el.isConnected && typeof el.focus === 'function' && !el.disabled &&
            el.getClientRects().length > 0 && !el.closest('[inert]');
        /**
         * Back to what opened the panel; when that is gone, hidden or disabled (an item of a menu that
         * closed, a button in a modal that closed), to what names or controls its container, the way a
         * menu names its toggle. With neither, focus is left on the document's body.
         */
        function returnFocus(options) {
            if (focusable(opener) && (!keep.shown || opener.ownerDocument !== document)) return opener.focus(options);
            if (keep.shown) return keep.frame.contentWindow.focus(); // the person is in the frame: the keyboard goes there
            const ancestors = [];
            for (let node = opener && opener.parentElement; node; node = node.parentElement) ancestors.push(node);
            const candidates = [];
            for (const node of ancestors) {
                for (const id of (node.getAttribute('aria-labelledby') || '').split(/\s+/)) {
                    if (id) candidates.push(document.getElementById(id));
                }
            }
            for (const node of ancestors) {
                if (node.id) candidates.push(...document.querySelectorAll(`[aria-controls~="${window.CSS.escape(node.id)}"]`));
            }
            const standIn = candidates.find(focusable);
            if (standIn) standIn.focus(options);
        }
        function focusables() {
            return [...ui.card.querySelectorAll('button, textarea, video[controls], pre[tabindex], [tabindex="0"]')]
                .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
        }
        function focusFirst() {
            if (mode !== 'dialog') return;
            let target;
            if (state.done) target = ui.closeButton;
            else if (!state.type && cfg.types.length > 1) target = ui.radios.find(r => r.tabIndex === 0);
            else target = ui.textarea;
            (target || focusables()[0] || ui.card).focus();
        }
        /**
         * While the widget shows, the host page's own focus traps (a Bootstrap modal's, jQuery UI's, a
         * native <dialog>'s script) never see focus moving inside it: a capturing listener on window runs
         * before any listener on document, whatever order they were added in. Focus leaving the open
         * dialog is brought back once, never re-entered, so two traps cannot call each other forever.
         */
        function guardFocus(on) {
            if (on === focusGuarded) return;
            focusGuarded = on;
            for (const type of ['focusin', 'focus', 'focusout', 'blur']) {
                if (on) window.addEventListener(type, onFocusEvent, true);
                else window.removeEventListener(type, onFocusEvent, true);
            }
        }
        function onFocusEvent(e) {
            if (e.target === ui.host) return e.stopImmediatePropagation();
            if (e.type !== 'focusin' || mode !== 'dialog' || refocusing) return;
            refocusing = true;
            try { focusFirst(); } finally { refocusing = false; }
        }
        /** The host page's open modal <dialog>, which makes everything outside it inert; null when none. */
        function hostModal() {
            if (keep.modal) return keep.layer; // the frame, made modal over a page's own dialog
            const open = [...document.querySelectorAll('dialog')].filter(d => d !== layer && d !== keep.layer && d.matches(':modal'));
            return open.find(d => d.contains(document.activeElement)) || open[open.length - 1] || null;
        }
        /** Whatever the page has in the top layer, over which only the top layer is higher: a modal dialog or a popover. */
        function coveredTopLayer() {
            let popovers = [];
            try { popovers = [...document.querySelectorAll(':popover-open')]; } catch {}
            return hostModal() || popovers.filter(p => !p.contains(ui.host))[0] || null;
        }
        /**
         * Where the widget's host element lives. Normally at the end of the body. Over a host modal
         * <dialog>, the dialog goes into a modal <dialog> of the widget's own, the top of the top layer;
         * the recording pill goes inside the host's dialog, so the page stays usable while recording;
         * a screenshot is taken with the host on the body, inert but painted.
         */
        function place(where) {
            const modal = where === 'page' ? null : where === 'dialog' ? coveredTopLayer() : hostModal();
            if (where === 'dialog' && modal) {
                if (!layer) {
                    layer = document.createElement('dialog');
                    layer.setAttribute('data-feedback-layer', '');
                    Object.assign(layer.style, { // CSSOM properties, which a strict style-src allows
                        padding: '0', border: '0', margin: '0', inset: '0', width: '100%', height: '100%',
                        maxWidth: 'none', maxHeight: 'none', background: 'transparent', overflow: 'visible', outline: 'none'
                    });
                    layer.addEventListener('cancel', e => { e.preventDefault(); close(); });
                }
                if (!layer.isConnected) (document.body || document.documentElement).append(layer);
                if (ui.host.parentNode !== layer) layer.append(ui.host);
                if (layer.open && keep.modal) layer.close(); // reopened, so it is above the frame's dialog
                if (!layer.open) layer.showModal();
                return;
            }
            if (layer && layer.open) layer.close();
            const parent = where === 'pill' && modal ? modal : document.body || document.documentElement;
            // last in its parent, so the pill is the last Tab stop (the frame's layer is added after it)
            if (ui.host.parentNode !== parent || ui.host.nextElementSibling) parent.append(ui.host);
            if (parent === modal && modal !== keep.layer) { // the host's dialog closing while recording takes the pill back to the body
                modal.addEventListener('close', () => { if (ui.host.parentNode === modal) place('page'); }, {once: true});
            }
        }
        function onCardKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            } else if (e.key === 'Tab') {
                const list = focusables();
                if (!list.length) return;
                const at = list.indexOf(ui.root.activeElement);
                if (e.shiftKey && at <= 0) {
                    e.preventDefault();
                    list[list.length - 1].focus();
                } else if (!e.shiftKey && (at === -1 || at === list.length - 1)) {
                    e.preventDefault();
                    list[0].focus();
                }
            }
        }
        function onRadioKey(e) {
            const steps = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1};
            let step = ownValue(steps, e.key);
            if (!step) return;
            if (dir === 'rtl' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) step = -step;
            e.preventDefault();
            const n = cfg.types.length;
            const at = Math.max(0, ui.radios.indexOf(ui.root.activeElement));
            const next = (at + step + n) % n;
            pickType(cfg.types[next]);
            ui.radios[next].focus();
        }
        function pickType(t) {
            state.type = t;
            writeDraft();
            render();
        }
        function onInput() {
            state.message = ui.textarea.value.slice(0, cfg.messageMaxLength);
            writeDraft();
            renderCounter();
            renderSend();
            if (previewOpen) queuePreview();
        }

        // ---- The report

        /**
         * Recent same-origin requests, oldest first: this page's, or every page's of a walk, each named by
         * its page. Past requestCount, failed requests are kept ahead of the rest: across several pages
         * the newest are all the last page's scripts and styles.
         */
        function requestEntries() {
            // the widget's own traffic is not the page's: its two files, by any version, and earlier reports
            const bare = u => { try { const x = new URL(u); x.search = x.hash = ''; return x.href; } catch { return u; } };
            const own = new Set([cfg.panelSrc, core.src].filter(Boolean).map(bare));
            let list;
            if (keep.pages.length > 1) {
                list = timings(performance, topUrl()).concat(keep.requests);
                if (here()) list = list.concat(timings(here().perf, here().doc.URL, true));
                list.sort((a, b) => a.at - b.at);
            } else list = timings(here() ? here().perf : performance, '');
            list = fresh(list).filter(e => {
                try { return new URL(e.name).origin === location.origin && e.name !== cfg.endpoint && !own.has(bare(e.name)); } catch { return false; }
            });
            const n = cfg.requestCount;
            if (list.length <= n) return list;
            const failed = list.filter(e => e.responseStatus >= 400).slice(-n);
            const rest = list.filter(e => !(e.responseStatus >= 400));
            return failed.concat(rest.slice(rest.length - (n - failed.length))).sort((a, b) => a.at - b.at);
        }
        function buildReport(sentAt) {
            const r = {
                schemaVersion: SCHEMA_VERSION, id: state.id, widgetVersion: VERSION, type: state.type,
                message: state.message.slice(0, cfg.messageMaxLength),
                url: cut(scrub.url(location.href), 2000)
            };
            const optional = (k, v) => { if (v !== undefined && v !== null && v !== '') r[k] = v; };
            optional('title', cut(documentText('title'), 200));
            optional('referrer', cut(scrub.url(cut(documentText('referrer'), 8000)), 2000));
            r.openedAt = iso(state.openedAt);
            r.sentAt = iso(sentAt);
            optional('project', cfg.project);
            optional('environment', cfg.environment);
            optional('release', cfg.release);
            optional('user', context.user);
            if (Object.keys(context.context).length) r.context = context.context;
            if (cfg.collect.client) r.client = clientFacts();
            const errors = cfg.collect.errors ? allErrors() : [];
            if (errors.length) r.errors = errors.map(errorEntry);
            if (cfg.collect.requests) {
                const list = requestEntries().map(e => {
                    const q = {url: cut(scrub.url(e.name), 2000)};
                    if (e.responseStatus > 0) q.status = e.responseStatus;
                    q.ms = Math.round(e.duration);
                    q.at = iso(e.at);
                    if (ownValue(e, 'page')) q.page = cut(scrub.url(e.page), 2000);
                    return q;
                });
                if (list.length) r.requests = list;
            }
            if (keep.pages.length > 1) {
                r.pages = keep.pages.slice(-50).map(p => {
                    const q = {url: cut(scrub.url(p.url), 2000)};
                    if (p.title) q.title = cut(p.title, 200);
                    q.at = iso(p.at);
                    return q;
                });
            }
            const attachments = {};
            if (state.screenshot) {
                attachments.screenshot = {type: state.screenshot.blob.type, bytes: state.screenshot.blob.size, size: state.screenshot.size};
                if (state.screenshot.surface) attachments.screenshot.surface = state.screenshot.surface;
            }
            if (state.video) {
                const v = state.video;
                attachments.video = {type: v.blob.type, bytes: v.blob.size, size: v.size, ms: v.ms, frameRate: v.frameRate};
                if (v.surface) attachments.video.surface = v.surface;
            }
            if (Object.keys(attachments).length) r.attachments = attachments;
            return fit(wellFormedValue(r));
        }
        function errorEntry(e) {
            const out = {kind: e.kind, message: cut(scrub.text(e.message || ''), 500)};
            if (e.source) out.source = cut(scrub.url(e.source), 2000);
            if (Number.isInteger(e.line) && e.line > 0) out.line = e.line;
            if (Number.isInteger(e.column) && e.column > 0) out.column = e.column;
            if (e.stack) out.stack = cut(scrub.text(e.stack), 2000);
            out.at = iso(e.at);
            out.count = e.count;
            if (ownValue(e, 'page')) out.page = cut(scrub.url(e.page), 2000);
            return out;
        }
        function clientFacts() {
            let timeZone = '';
            try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
            const c = {userAgent: cut(navigator.userAgent, 500), language: navigator.language || ''};
            if (timeZone) c.timeZone = timeZone;
            Object.assign(c, {
                viewport: [innerWidth, innerHeight], screen: [screen.width, screen.height],
                pixelRatio: devicePixelRatio, online: navigator.onLine, touch: navigator.maxTouchPoints > 0
            });
            return c;
        }
        /** Holds the whole document under 256 KB: stacks go first, then the oldest errors and requests, then context. */
        function fit(r) {
            while (utf8Bytes(JSON.stringify(r)) > REPORT_MAX_BYTES) {
                const withStack = Array.isArray(r.errors) && r.errors.find(e => e && e.stack);
                if (withStack) delete withStack.stack;
                else if (Array.isArray(r.errors) && r.errors.length) r.errors.length > 1 ? r.errors.shift() : delete r.errors;
                else if (Array.isArray(r.requests) && r.requests.length) r.requests.length > 1 ? r.requests.shift() : delete r.requests;
                else if (r.context) delete r.context;
                else break;
            }
            return r;
        }

        // ---- Sending

        async function send(without) {
            if (state.busy || !state.type || !state.message.trim()) return;
            if (without) removeAttachment(without);
            const gen = generation; // a reset() while this is in flight makes its answer no one's
            state.busy = true;
            state.alert = '';
            state.offer = null;
            render();
            // the timeout covers the host's hooks too: one that never settles still ends in the failure row
            const deadline = Date.now() + cfg.timeoutMs;
            const inTime = (value, hook) => Promise.race([Promise.resolve(value), new Promise((resolve, reject) => setTimeout(
                () => reject(Object.assign(new Error(`${hook} did not settle within timeoutMs`), {late: true})), Math.max(0, deadline - Date.now())))]);
            const giveUp = () => {
                state.busy = false;
                render();
            };
            let report = buildReport(Date.now());
            const files = Object.create(null); // read by name: nothing from a polluted prototype
            if (state.screenshot) files.screenshot = state.screenshot.blob;
            if (state.video) files.video = state.video.blob;
            if (cfg.beforeSend) {
                let answer;
                try { answer = await inTime(cfg.beforeSend(report, files), 'beforeSend'); } catch (e) {
                    if (gen !== generation) return;
                    say('error', (e && e.late ? '' : 'beforeSend threw, so nothing was sent: ') + e);
                    if (e && e.late) {
                        state.busy = false;
                        return settle({kind: 'failed', status: 0}, report, gen);
                    }
                    answer = false;
                }
                if (gen !== generation) return;
                if (answer === false) return giveUp();
                if (isObject(answer)) report = answer;
                for (const [k, types] of [['screenshot', /^image\/(webp|jpeg|png)$/], ['video', /^video\/(webm|mp4)$/]]) {
                    const file = ownValue(files, k);
                    if (file !== undefined && !(file instanceof Blob && types.test(file.type))) say('error', `beforeSend gave a ${k} that is not one; it is left out`);
                    if (!(file instanceof Blob && types.test(file.type))) {
                        delete files[k];
                        if (isObject(report.attachments)) delete report.attachments[k];
                    }
                }
                if (isObject(report.attachments) && !Object.keys(report.attachments).length) delete report.attachments;
                report = capped(report);
                if (!report) {
                    say('error', 'the report from beforeSend is not JSON or lacks a required field, so nothing was sent');
                    return giveUp();
                }
            }
            const reportText = JSON.stringify(fit(wellFormedValue(report)));
            const body = new FormData();
            for (const [k, v] of Object.entries(cfg.fields)) body.append(k, v);
            body.append('report', reportText);
            if (files.screenshot) body.append('screenshot', files.screenshot, 'screenshot.' + extension(files.screenshot.type));
            if (files.video) body.append('video', files.video, 'video.' + extension(files.video.type));

            let outcome;
            const abort = new AbortController();
            const timer = setTimeout(() => abort.abort(), Math.max(0, deadline - Date.now()));
            try {
                let headers = cfg.headers;
                if (typeof headers === 'function') headers = await inTime(headers(), 'headers');
                if (!textMap(headers)) throw new TypeError('"headers" did not give an object of text values');
                const response = await fetch(cfg.endpoint, {
                    method: 'POST', body, headers, credentials: cfg.credentials, redirect: 'error', signal: abort.signal
                });
                outcome = readAnswer(response, await response.text());
            } catch (e) {
                if (e && e.message && /headers/.test(e.message)) say('error', e.message);
                outcome = {kind: 'failed', status: 0};
            } finally {
                clearTimeout(timer);
            }
            if (gen !== generation) return;
            state.busy = false;
            settle(outcome, report, gen);
        }
        /**
         * The report as the host's beforeSend left it, held to the protocol again: JSON, 16 levels at most,
         * the required fields there and well typed, every capped field cut. Null when it cannot be sent.
         */
        function capped(given) {
            let r;
            try { r = JSON.parse(JSON.stringify(given)); } catch { return null; }
            if (!isObject(r) || depth(r) > 16) return null;
            const time = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
            const required = {schemaVersion: v => v === SCHEMA_VERSION, id: v => typeof v === 'string' && UUID.test(v),
                widgetVersion: v => typeof v === 'string', type: v => cfg.types.includes(v),
                message: v => typeof v === 'string' && v.trim() !== '', url: v => typeof v === 'string', openedAt: time, sentAt: time};
            for (const [k, check] of Object.entries(required)) if (!check(ownValue(r, k))) return null;
            const caps = {message: cfg.messageMaxLength, url: 2000, title: 200, referrer: 2000, project: 50, environment: 30,
                release: 40, widgetVersion: 20, type: 20};
            for (const [k, n] of Object.entries(caps)) if (typeof ownValue(r, k) === 'string') r[k] = cut(r[k], n);
            if (hasOwn(r, 'user')) {
                const user = userValue(r.user);
                if (user) r.user = user;
                else delete r.user;
            }
            if (hasOwn(r, 'context') && !contextValue(r.context)) {
                warn('the context from beforeSend is over 16 KB or too deep; it is left out');
                delete r.context;
            }
            for (const [k, n] of [['errors', core.own.errorBufferSize || 50], ['requests', cfg.requestCount], ['pages', 50]]) {
                if (!hasOwn(r, k)) continue;
                if (Array.isArray(r[k])) r[k] = r[k].slice(-n);
                else delete r[k];
            }
            return r;
        }
        function sendWithoutOffer() {
            const part = state.offer;
            state.offer = null;
            send(part);
        }

        /** The answer table: success, or a refusal read from the code, else the status. */
        function readAnswer(response, bodyText) {
            let status = response.status;
            let json = null;
            try { json = JSON.parse(bodyText); } catch {}
            if (!isObject(json)) json = null;
            const error = ownValue(json, 'error');
            const jsonId = ownValue(json, 'id'), jsonMessage = ownValue(json, 'message');
            const ok = status >= 200 && status < 300;
            if (ok && !error) {
                const id = typeof jsonId === 'string' || typeof jsonId === 'number' ? cut(String(jsonId), 100) : '';
                const message = typeof jsonMessage === 'string' ? cut(jsonMessage, 300) : '';
                return {kind: 'sent', status, id, message};
            }
            const e = isObject(error) ? error : {};
            const errorCode = ownValue(e, 'code');
            const code = typeof errorCode === 'string' ? errorCode : '';
            if (ok) status = Number.isInteger(errorCode) && errorCode >= 400 && errorCode <= 599 ? errorCode : 400; // a dispatcher's 200
            const pickText = [ownValue(e, 'message'), ownValue(e, 'msg'), jsonMessage, typeof error === 'string' ? error : '']
                .find(x => typeof x === 'string' && x);
            const errorField = ownValue(e, 'field');
            const field = typeof errorField === 'string' ? errorField : '';
            const byStatus = {400: 'invalid', 422: 'invalid', 401: 'unauthorized', 403: 'unauthorized', 413: 'tooLarge',
                415: 'unsupportedMedia', 429: 'rateLimited', 503: 'disabled'};
            const known = ['invalid', 'unsupportedVersion', 'unauthorized', 'tooLarge', 'unsupportedMedia', 'rateLimited', 'disabled'];
            const kind = known.includes(code) ? code : ownValue(byStatus, status) || (status >= 500 ? 'failed' : 'refused');
            let retryAt = 0;
            if (kind === 'rateLimited') {
                // seconds, or an HTTP date, within a day; anything else is no time at all
                const after = (response.headers.get('Retry-After') || '').trim();
                const at = /^\d{1,6}$/.test(after) ? Date.now() + Number(after) * 1000 : /[a-z]/i.test(after) ? Date.parse(after) : NaN;
                if (Number.isFinite(at) && at >= Date.now() - 60000 && at <= Date.now() + 86400000) retryAt = at;
            }
            return {kind, status, code, field, retryAt, text: pickText ? cut(pickText, 300) : ''};
        }
        function settle(outcome, report, gen) {
            if (gen !== generation) return; // reset while it was on its way: no one's answer
            // every field own, so nothing is read from a polluted prototype
            const o = Object.assign({kind: 'failed', status: 0, code: '', field: '', retryAt: 0, text: '', id: '', message: ''}, outcome);
            state.failed = false;
            if (o.kind === 'sent') {
                dropDraft();
                for (const k of ['screenshot', 'video']) removeAttachment(k, true);
                Object.assign(state, {id: null, type: null, message: '', alert: '', notice: '', offer: null, done: {id: o.id, message: o.message}});
                forgetWalk();
                render();
                focusFirst();
                callHook('onSent', {id: o.id, message: o.message, report});
                return;
            }
            let message = o.text;
            switch (o.kind) {
                case 'invalid': message = message || L.invalid; break;
                case 'unsupportedVersion': message = message || L.outdated; break;
                case 'unauthorized': message = joined(message, L.signIn); writeDraft(); break;
                case 'tooLarge':
                case 'unsupportedMedia': {
                    message = message || (o.kind === 'tooLarge' ? L.tooLarge : L.unsupportedMedia);
                    const named = o.field === 'video' || o.field === 'screenshot' ? o.field : '';
                    state.offer = named ? (state[named] ? named : null) : !o.field ? (state.video ? 'video' : state.screenshot ? 'screenshot' : null) : null;
                    break;
                }
                case 'rateLimited': {
                    const until = o.retryAt ? fill(L.rateLimitedUntil, {time: timeText(o.retryAt)}) : '';
                    message = message ? joined(message, until) : until || L.rateLimited;
                    break;
                }
                case 'disabled': message = message || L.disabled; break;
                case 'refused': message = message || fill(L.refused, {status: o.status}); break;
                default:
                    message = joined(L.failed, message);
                    state.failed = true;
            }
            state.alert = cut(message, 600);
            render();
            ui.alert.scrollIntoView({block: 'nearest'}); // the refusal and its offer are in view when they appear
            // the keyboard is never left on the page: once the alert is out, on the offer, else on Retry or Send
            setTimeout(() => {
                if (mode === 'dialog' && !state.busy && gen === generation) (state.offer ? ui.offerButton : ui.sendButton).focus();
            }, 150);
            callHook('onError', {status: o.status, code: o.code || o.kind, message: o.text || ''});
        }
        /** The receiver's sentence, then the widget's; a full stop between when the first has none. */
        function joined(first, second) {
            if (!first || !second) return first || second;
            return first + (/[.!?。！？]$/.test(first.trim()) ? ' ' : '. ') + second;
        }
        function timeText(ms) {
            const d = new Date(ms);
            const today = d.toDateString() === new Date().toDateString();
            const options = today ? {hour: 'numeric', minute: '2-digit', second: ms - Date.now() < 600000 ? '2-digit' : undefined}
                : {dateStyle: 'medium', timeStyle: 'short'};
            try { return new Intl.DateTimeFormat(locale, options).format(d); } catch { return d.toLocaleString(); }
        }
        function callHook(name, ...args) {
            const f = cfg[name];
            if (!f) return;
            try {
                const result = f(...args);
                if (result && typeof result.catch === 'function') result.catch(e => say('error', `${name} failed: ${e}`));
            } catch (e) { say('error', `${name} threw: ${e}`); }
        }

        // ---- Capture: through the browser's own prompt every time; this tab only wherever the browser can promise it

        const SURFACES = ['browser', 'window', 'monitor'];
        function captureThisTab(forVideo) {
            const how = captureMode();
            if (!how) return Promise.reject(new Error('capture is not available'));
            const video = how === 'tab' ? {displaySurface: 'browser'} : {};
            if (forVideo) {
                video.frameRate = {ideal: cfg.video.frameRate, max: cfg.video.frameRate};
                video.width = {max: cfg.video.maxWidth};
            }
            const options = how === 'tab' ? {
                video, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude',
                monitorTypeSurfaces: 'exclude', audio: false
            } : {video: Object.keys(video).length ? video : true, audio: false};
            return navigator.mediaDevices.getDisplayMedia(options).then(stream => {
                const track = stream.getVideoTracks()[0];
                let surface;
                try { surface = track && typeof track.getSettings === 'function' ? track.getSettings().displaySurface : undefined; } catch {}
                if (!track || how === 'tab' && surface !== 'browser') { // a screen, a window, or no video: thrown away
                    stream.getTracks().forEach(t => t.stop());
                    throw Object.assign(new Error('not this tab'), {name: how === 'tab' ? 'NotThisTab' : 'NoVideo'});
                }
                return {stream, track, surface: SURFACES.includes(surface) ? surface : undefined};
            });
        }
        function captureProblem(e) {
            if (e && e.name === 'NotAllowedError' || e && e.name === 'AbortError') return '';
            return e && e.name === 'NotThisTab' ? L.onlyThisTab : L.captureFailed;
        }
        function takeScreenshot() {
            state.notice = '';
            mode = 'capturing';
            const gen = generation;
            let capture;
            try { capture = captureThisTab(false); } catch (e) { capture = Promise.reject(e); }
            capture.then(async ({stream, track, surface}) => {
                try {
                    if (gen !== generation) return; // reset while the browser was asking: nothing is kept
                    const v = document.createElement('video');
                    v.muted = true;
                    v.playsInline = true;
                    v.srcObject = stream;
                    await frameWithoutPanel(v);
                    const {blob, canvas} = await encodeShot(v);
                    v.srcObject = null;
                    if (gen !== generation) return;
                    removeAttachment('screenshot', true);
                    state.screenshot = {blob, url: URL.createObjectURL(blob), size: [canvas.width, canvas.height], surface, node: null};
                } finally {
                    track.stop();
                    stream.getTracks().forEach(t => t.stop());
                }
            }).catch(e => {
                state.notice = captureProblem(e);
            }).then(() => {
                if (mode !== 'capturing') return;
                mode = 'closed';
                open(null, true);
                (state.screenshot ? ui.media.querySelector('.item button') : null)?.focus();
            });
        }
        /**
         * The frame as WebP (JPEG where the browser cannot write WebP), at most SHOT_MAX_SIDE pixels on its
         * longer side and SHOT_MAX_BYTES long: a whole screen, several monitors wide, is scaled down until it
         * fits, so it never meets a receiver's 8,192-pixel or 5 MB limit.
         */
        async function encodeShot(v) {
            let scale = Math.min(1, SHOT_MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
            for (let tries = 0; ; tries++) {
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(v.videoWidth * scale));
                canvas.height = Math.max(1, Math.round(v.videoHeight * scale));
                canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
                let blob = await new Promise(r => canvas.toBlob(r, 'image/webp', 0.8));
                if (!blob || blob.type !== 'image/webp') blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
                if (!blob) throw new Error('encoding failed');
                if (blob.size <= SHOT_MAX_BYTES || tries >= 5) return {blob, canvas};
                scale *= 0.75;
            }
        }
        /**
         * The panel hides once the stream is live, and the frame drawn is one captured after that was
         * painted. A tab sends frames only when something on it changes.
         */
        async function frameWithoutPanel(v) {
            v.play().catch(() => {});
            place('page');
            ui.backdrop.hidden = ui.card.hidden = ui.pill.hidden = true;
            ui.nudge.hidden = false;
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const hiddenAt = performance.now();
            // A still page may send no frame at all: a near-invisible pixel that changes makes it send one
            const nudging = setInterval(() => ui.nudge.classList.toggle('flip'), 100);
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 3000);
                const done = () => { clearTimeout(timer); resolve(); };
                if (typeof v.requestVideoFrameCallback !== 'function') {
                    return v.addEventListener('loadeddata', () => setTimeout(done, 300), {once: true});
                }
                const next = () => v.requestVideoFrameCallback((now, meta) => {
                    if (meta.captureTime === undefined || meta.captureTime >= hiddenAt) done();
                    else next();
                });
                next();
            });
            clearInterval(nudging);
            ui.nudge.hidden = true;
            if (!v.videoWidth) throw new Error('no frame arrived');
        }

        function startRecording() {
            state.notice = '';
            mode = 'capturing';
            const gen = generation;
            let capture;
            try { capture = captureThisTab(true); } catch (e) { capture = Promise.reject(e); }
            capture.then(({stream, track, surface}) => {
                if (mode !== 'capturing' || gen !== generation) { // reset or closed while the browser was asking
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                const type = RECORDING_TYPES.find(t => MediaRecorder.isTypeSupported(t));
                let recorder;
                try { recorder = new MediaRecorder(stream, {mimeType: type, videoBitsPerSecond: cfg.video.bitsPerSecond}); } catch (e) {
                    stream.getTracks().forEach(t => t.stop()); // a capture is never left live
                    throw e;
                }
                const settings = track.getSettings();
                const rec = state.recording = {
                    recorder, stream, track, type: type.split(';')[0], chunks: [], bytes: 0, started: performance.now(),
                    ms: 0, size: [settings.width || 0, settings.height || 0], frameRate: Math.round(settings.frameRate || cfg.video.frameRate),
                    reason: '', discard: false, timer: 0, surface
                };
                recorder.ondataavailable = e => {
                    if (!e.data || !e.data.size) return;
                    rec.chunks.push(e.data);
                    rec.bytes += e.data.size;
                    const perSecond = rec.bytes / Math.max(1, (performance.now() - rec.started) / 1000);
                    if (rec.bytes + perSecond * 1.5 >= cfg.video.maxBytes) stopRecording(false, 'size');
                };
                recorder.onstop = () => finishRecording(rec);
                track.addEventListener('ended', () => stopRecording(false));
                try { recorder.start(1000); } catch (e) {
                    state.recording = null;
                    stream.getTracks().forEach(t => t.stop());
                    throw e;
                }
                rec.timer = setInterval(() => {
                    const elapsed = performance.now() - rec.started;
                    ui.time.textContent = clock(elapsed);
                    if (elapsed >= cfg.video.maxSeconds * 1000) stopRecording(false, 'time');
                }, 250);
                mode = 'pill';
                keepStart();
                ui.time.textContent = '0:00';
                place('pill');
                ui.host.hidden = false;
                ui.backdrop.hidden = ui.card.hidden = true;
                ui.pill.hidden = false;
                // Focus goes back to the page, so typing (a scanner's keys and Enter) carries on there and
                // never presses Stop; the pill is the last Tab stop and its status is announced
                ui.pillStatus.textContent = L.recording;
                // Never the stand-in returnFocus would choose (a menu's toggle takes a scanner's Enter): with the
                // opener gone, focus is left on the body, where the keys reach the page's own handlers
                if (keep.shown) keep.frame.contentWindow.focus();
                else if (focusable(opener) && opener.ownerDocument === document) opener.focus({preventScroll: true});
                else if (ui.root.activeElement) ui.root.activeElement.blur();
            }).catch(e => {
                state.notice = captureProblem(e);
                if (mode !== 'capturing') return;
                mode = 'closed';
                open(null, true);
            });
        }
        function stopRecording(discardIt, reason) {
            const rec = state.recording;
            if (!rec) return;
            if (discardIt) rec.discard = true;
            if (reason && !rec.reason) rec.reason = reason;
            clearInterval(rec.timer);
            if (!rec.ms) rec.ms = Math.round(performance.now() - rec.started);
            if (rec.recorder.state !== 'inactive') rec.recorder.stop();
            rec.stream.getTracks().forEach(t => t.stop());
        }
        function finishRecording(rec) {
            if (state.recording !== rec) return;
            state.recording = null;
            if (rec.discard) return keepExit();
            const recorded = new Blob(rec.chunks, {type: rec.type});
            // its length written in, so the preview, a receiver and a saved file can show it and seek
            const lengthKnown = rec.type === 'video/webm' ? webmWithDuration(recorded, rec.ms) : Promise.resolve(recorded);
            state.finishing = rec;
            lengthKnown.then(blob => attachRecording(rec, blob));
        }
        function attachRecording(rec, blob) {
            if (state.finishing !== rec) return; // reset while its length was being written
            state.finishing = null;
            if (blob.size) {
                removeAttachment('video', true);
                state.video = {blob, url: URL.createObjectURL(blob), size: rec.size, ms: rec.ms, frameRate: rec.frameRate, surface: rec.surface, node: null};
            }
            state.notice = rec.reason === 'left' ? L.recordingLeft : rec.reason === 'blocked' ? L.recordingBlocked : !blob.size ? L.captureFailed
                : rec.reason === 'size' ? L.recordingSizeLimit : rec.reason === 'time' ? L.recordingTimeLimit : '';
            const closeAfter = state.closeAfterStop;
            state.closeAfterStop = false;
            mode = 'closed';
            if (closeAfter) {
                ui.host.hidden = true;
                place('page');
                guardFocus(false);
                return keepExit();
            }
            if (!keep.shown && !keep.pending && !keep.exitTo) { // on the page the recording began on: nothing is held
                keepOff();
                dropFrame();
            }
            open(null, true);
            (ui.media.querySelector('.item.video video') || ui.sendButton).focus();
        }
        function removeAttachment(k, quietly) {
            const a = state[k];
            if (!a) return;
            URL.revokeObjectURL(a.url);
            state[k] = null;
            if (state.offer === k) state.offer = null;
            if (!quietly) render();
        }

        // ---- A recording follows the person from page to page
        //
        // The capture belongs to this document, so while a recording runs this document is not
        // unloaded. A navigation that would replace it is cancelled (preventDefault on the Navigation
        // API's cross-document navigate event; intercept() would leave a download's navigation pending
        // for ever) and its destination is loaded in a same-origin frame laid over the page; once that
        // page is there the frame is shown, the address and title follow it, and later navigations
        // happen inside the frame by themselves. When the panel closes the person stays in the frame,
        // with what they typed and their place on the page. Their next GET navigation out of it starts in
        // the frame as any other; once it commits there (so never for a download, a 204 or a navigation
        // refused at the page's own "Leave site?") the frame goes blank, its history is wound back, and
        // the window goes to that page for real, which requests it a second time. While a recording or a
        // screenshot is held unsent nothing exits: the frame keeps following. A destination on another
        // origin ends the recording, keeps it, and is gone to once the panel closes. Without the
        // Navigation API, or with video.follow false, none of this is installed.
        //
        // History: the frame starts on a blank document of its own (srcdoc), so every page it shows is
        // a step of the frame's history. This window's own entry is only ever rewritten in place
        // (replaceState), never pushed: a page beneath that hears popstate may reload itself. Back from
        // the first framed page lands the frame on its blank document, which is the signal to show the
        // first page again.

        const BLANK = 'about:srcdoc';
        const keep = {on: false, layer: null, frame: null, shown: false, modal: false, pending: '', pendingAt: 0, asked: '',
            toBlank: false, cur: null, exitTo: '', exiting: '', going: '', rewinding: false, arrived: false, lazy: false,
            journal: [], requests: [], pages: [], inert: [], saved: null, start: null, n: 0, blankKey: '', blankIndex: 0,
            index: 0, cut: ownValue(core.own, 'cut') || 0, installed: false, printing: null, blocked: false};
        const held = () => !!(state.video || state.screenshot);

        function canKeep() {
            return !!(cfg.video && cfg.video.follow && window.navigation && typeof window.NavigateEvent === 'function');
        }
        function keepStart() {
            if (!canKeep()) return;
            keep.lazy = false;
            keep.exitTo = '';
            if (keep.exiting) abandonExit();
            if (!keep.installed) { // once a recording has followed, what it holds is guarded until the page goes
                keep.installed = true;
                addEventListener('beforeunload', onLeaving);
                addEventListener('beforeprint', onBeforePrint);
                addEventListener('afterprint', onAfterPrint);
                document.addEventListener('toggle', onCoveredToggle, true);
                document.addEventListener('securitypolicyviolation', onPolicyViolation);
            }
            if (keep.on) return; // already following: a second recording made from inside the frame
            keep.on = true;
            if (!keep.start) {
                keep.start = {url: location.href, title: documentText('title'), at: Date.now()};
                keep.pages = [keep.start];
            }
            navigation.addEventListener('navigate', onTopNavigate);
            if (!keep.frame && !makeFrame()) keepOff(); // Trusted Types refused the frame: the recording ends at the page change
        }
        function keepOff() {
            if (!keep.on) return;
            keep.on = false;
            navigation.removeEventListener('navigate', onTopNavigate);
        }
        function forgetAll() {
            keep.start = null;
            keep.pages = [];
            keep.journal = [];
            keep.requests = [];
        }
        /** The walk so far is forgotten: nothing visited, and nothing the covered page held, is reported again. */
        function forgetWalk() {
            const here = keep.shown && keep.cur ? {url: keep.cur.url, title: keep.cur.doc.title, at: Date.now()} : null;
            keep.start = here;
            keep.pages = here ? [here] : [];
            keep.journal = [];
            keep.requests = [];
            if (keep.cur) keep.cur.buffer.length = 0;
            if (keep.on) keep.cut = Date.now();
        }
        /**
         * The panel has closed and nothing is recording. In the frame, the person stays there (the lazy
         * state; see onFrameNavigate). Otherwise the window goes to where the person asked to go (a page
         * on its way, or another site), or, with nothing pending, the frame is dropped.
         */
        function keepExit() {
            if (!keep.on || keep.exiting || state.recording || mode !== 'closed') return;
            if (keep.shown && !keep.exitTo) {
                keep.lazy = true;
                return;
            }
            const to = keep.exitTo || (Date.now() - keep.pendingAt < 10000 ? keep.pending : '');
            if (!to) {
                keepOff();
                dropFrame();
                forgetAll();
                return;
            }
            keep.lazy = false;
            keep.exiting = to;
            if (keep.shown) rewind(!frameUrl());
            else finishExit();
        }
        /** The lazy exit's navigation has committed in the frame: a blank moment until the window is there. */
        function beginExit() {
            keep.exiting = keep.going;
            keep.going = '';
            keep.lazy = false;
            keep.arrived = false;
            keep.frame.style.visibility = 'hidden';
            layerStyle('background', 'Canvas');
        }
        /** The exit did not happen (refused at a page's "Leave site?", or overtaken): the person stays where they are. */
        function abandonExit() {
            keep.exiting = keep.exitTo = keep.going = '';
            keep.rewinding = keep.arrived = false;
            if (keep.frame) keep.frame.style.visibility = '';
            if (keep.layer) layerStyle('background', 'transparent');
            if (keep.shown && mode === 'closed' && !state.recording) keep.lazy = true;
        }
        /**
         * The frame's pages are steps of the tab's history which Chrome keeps when the frame is removed (each
         * then a dead Back press), so the frame is first sent back to its blank document; the real
         * navigation made from there cuts the steps off. A frame on another origin cannot be asked: the
         * window's own history goes back by the steps counted as the pages arrived.
         */
        function rewind(crossed) {
            keep.rewinding = true;
            let nav = null;
            try { nav = keep.frame.contentWindow.navigation; } catch {}
            if (nav && nav.currentEntry && keep.blankKey) {
                if (nav.currentEntry.key === keep.blankKey) return finishExit();
                try { return void nav.traverseTo(keep.blankKey); } catch {} // the blank document's load finishes the exit
            }
            const steps = keep.index - keep.blankIndex + (crossed ? 1 : 0);
            if (steps > 0) return history.go(-steps);
            finishExit();
        }
        function finishExit() {
            const to = keep.exiting;
            keep.exiting = '';
            keep.rewinding = false;
            keepOff();
            if (keep.saved && location.href !== keep.saved.url) history.replaceState(history.state, '', keep.saved.url);
            // A page with unsaved changes (the first page, alive beneath) makes the browser ask. Answered
            // Stay, the person is on the first page again and must see it
            addEventListener('beforeunload', e => {
                if (e.defaultPrevented || e.returnValue) setTimeout(dropFrame, 0);
            }, {once: true});
            const bare = u => u.split('#')[0];
            const onlyTheFragment = to.includes('#') && bare(to) === bare(location.href);
            location.assign(to);
            if (onlyTheFragment) location.reload(); // an address this page already has, but for its fragment, would not load
        }
        /** What cannot be held (the browser's own Reload, a typed address, Back past the first page) asks first. */
        function onLeaving(e) {
            if (!state.recording && !held()) return;
            e.preventDefault();
            e.returnValue = '';
        }
        function frameUrl() {
            try { return keep.frame.contentWindow.location.href; } catch { return ''; }
        }
        /** The frame's own dialog, styled from script with priority, so a page's rules for dialog[open] cannot move it. */
        function layerStyle(name, value) {
            keep.layer.style.setProperty(name, value, 'important');
        }
        /**
         * The frame, in a <dialog> of its own: shown without being modal it is a plain layer over the
         * page, and over what the page put in the top layer (a modal <dialog>, a popover) it is made
         * modal, the only way above it. It is no dialog to assistive technology; the page in it is the page.
         */
        function makeFrame() {
            dropFrame();
            const layer = keep.layer = document.createElement('dialog');
            layer.setAttribute('closedby', 'none');
            // Chrome exposes a dialog whatever role none or presentation says; generic is exposed as nothing
            layer.setAttribute('role', 'generic');
            layer.setAttribute('data-feedback-frame-layer', '');
            const look = {position: 'fixed', inset: '0', width: '100%', height: '100%', 'max-width': 'none', 'max-height': 'none',
                'min-width': '0', 'min-height': '0', margin: '0', padding: '0', border: '0', 'border-radius': '0', background: 'transparent',
                overflow: 'hidden', outline: 'none', 'box-shadow': 'none', opacity: '1', transform: 'none', translate: 'none', scale: 'none',
                filter: 'none', animation: 'none', transition: 'none', 'pointer-events': 'auto',
                'z-index': String(Math.max(0, cfg.zIndex - 1)), visibility: 'hidden'};
            for (const [k, v] of Object.entries(look)) layerStyle(k, v);
            layer.addEventListener('cancel', e => e.preventDefault());
            const f = keep.frame = document.createElement('iframe');
            // a real blank document: what the frame goes to next is a new history step
            try { f.srcdoc = core.tt ? core.tt.createHTML('') : '<!doctype html><title></title>'; } catch {
                say('error', 'Trusted Types refused the frame a recording follows in: allow the policy "feedback"');
                keep.layer = keep.frame = null;
                return false;
            }
            f.name = 'feedback-keep-' + (++keep.n);
            f.title = document.title;
            f.setAttribute('data-feedback-frame', '');
            Object.assign(f.style, {display: 'block', width: '100%', height: '100%', border: '0', background: 'Canvas', colorScheme: 'light dark'});
            f.addEventListener('load', () => onFrameLoad(f));
            layer.append(f);
            (document.body || document.documentElement).append(layer);
            layer.show();
            return true;
        }
        function dropFrame() {
            if (keep.shown) hideFrame();
            if (keep.cur) collect(keep.cur);
            if (keep.layer) {
                if (keep.layer.contains(ui.host)) place('page');
                keep.layer.remove();
            }
            keep.layer = keep.frame = keep.cur = null;
            keep.pending = keep.asked = keep.blankKey = keep.going = '';
        }

        /** A navigation of this window: held in the frame when it can be, let go when it cannot. */
        function onTopNavigate(e) {
            if (e.hashChange || e.downloadRequest !== null || e.destination.sameDocument) return;
            if (e.navigationType === 'traverse' || !e.cancelable) return; // another document in history cannot be held
            let url;
            try { url = new URL(e.destination.url); } catch { return; }
            if (!/^https?:$/.test(url.protocol)) return;
            // Back on the first page after a report, with nothing held: the next page is gone to for real
            if (keep.lazy && !keep.shown && !state.recording && !held()) {
                keepOff();
                dropFrame();
                forgetAll();
                return;
            }
            e.preventDefault();
            // Behind the frame the first page still runs its timers: only what the person did is followed
            if (keep.shown && !e.userInitiated) return;
            if (url.origin !== location.origin) return leave(url.href); // the frame cannot follow to another site
            if (keep.shown) { // the browser's own Reload, or a link in the frame aimed at the whole window
                const w = keep.frame.contentWindow;
                keep.asked = url.href;
                keep.blocked = false;
                if (e.navigationType === 'reload') return w.location.reload();
                return e.formData ? post(url.href, e, keep.frame.name) : w.location.assign(url.href);
            }
            keep.pending = url.href;
            keep.pendingAt = Date.now();
            keep.blocked = false;
            if (e.formData) post(url.href, e, keep.frame.name);
            else keep.frame.contentWindow.location.assign(url.href);
        }
        /** A POST the window was about to make, made by the frame instead: the same fields, the same files. */
        function post(url, e, target) {
            const source = e.sourceElement;
            const form = source && (source.form || (source.closest && source.closest('form')));
            const f = h('form', {method: 'post', action: url, target, hidden: true});
            const enctype = (source && source.getAttribute && source.getAttribute('formenctype')) || (form && form.enctype);
            if (enctype) f.enctype = enctype;
            for (const [k, v] of e.formData) {
                const input = h('input', {type: typeof v === 'string' ? 'hidden' : 'file', name: k});
                if (typeof v === 'string') input.value = v;
                else {
                    const files = new DataTransfer();
                    if (v.name || v.size) files.items.add(v);
                    input.files = files.files;
                }
                f.append(input);
            }
            (document.body || document.documentElement).append(f);
            f.submit();
            f.remove();
        }
        /** A page has arrived in the frame; its stub calls this with its error buffer, the load event without. */
        function adopt(win, buffer) {
            if (!keep.on || !keep.frame || win !== keep.frame.contentWindow) return false;
            let url;
            try { url = win.location.href; } catch { return false; }
            if (url === 'about:blank' || url === BLANK) return false;
            if (keep.exiting) { // the page the person is leaving for has committed: the window goes there for real
                if (!keep.arrived) {
                    keep.arrived = true;
                    keep.exiting = url;
                    try { keep.index = win.navigation.currentEntry.index; } catch {}
                    setTimeout(() => rewind(false), 0);
                }
                return true;
            }
            if (keep.cur && keep.cur.doc === win.document) {
                if (buffer) keep.cur.buffer = buffer;
                return true;
            }
            if (keep.cur) collect(keep.cur);
            const page = keep.cur = {doc: win.document, buffer: buffer || [], perf: win.performance, url, at: Date.now(), done: false};
            try { keep.index = win.navigation.currentEntry.index; } catch {}
            win.addEventListener('pagehide', () => {
                collect(page);
                if (opener && opener.ownerDocument === page.doc) opener = null; // nothing holds a page that has gone
                if (keep.going && !keep.exiting && keep.cur === page) beginExit(); // the lazy exit's navigation commits
                else if (keep.toBlank && !keep.exiting) hideFrame(); // Back to the page the recording began on
            });
            if (win.navigation) {
                win.navigation.addEventListener('navigate', onFrameNavigate);
                win.navigation.addEventListener('currententrychange', () => { if (keep.cur === page) sync(); });
            }
            if (keep.pages.length < 50) keep.pages.push({url, title: win.document.title, at: page.at});
            keep.pending = '';
            keep.toBlank = false;
            showFrame(); // the swap: the page is there, so it is shown
            sync();
            return true;
        }
        function onFrameLoad(f) {
            if (f !== keep.frame) return;
            let url = null;
            try { url = f.contentWindow.location.href; } catch {}
            if (url === BLANK) { // Back to the page the recording began on (or the frame has only just been made)
                try {
                    if (!keep.blankKey) {
                        keep.blankKey = f.contentWindow.navigation.currentEntry.key;
                        keep.blankIndex = f.contentWindow.navigation.currentEntry.index;
                    }
                } catch {}
                if (keep.exiting) return finishExit();
                keep.toBlank = false;
                if (keep.cur) collect(keep.cur);
                keep.cur = null;
                hideFrame();
                return refocus();
            }
            if (url === 'about:blank') return;
            if (url === null) { // another site's page, a redirect there, or a refusal to be framed
                if (!keep.exiting) return leave(keep.asked || keep.pending, keep.blocked ? 'blocked' : 'left');
                if (!keep.arrived) {
                    keep.arrived = true;
                    rewind(true);
                }
                return;
            }
            if (!adopt(f.contentWindow, null) || keep.exiting) return;
            const p = keep.pages[keep.pages.length - 1];
            if (p && keep.cur && p.at === keep.cur.at) p.title = f.contentDocument.title;
            sync();
        }
        /**
         * A navigation inside the frame: followed, unless it leaves the site. In the lazy state a GET
         * navigation is let start here and the exit waits for it to commit (beginExit, from the page's
         * pagehide); one that never commits, a download or a 204, leaves the person where they are.
         */
        function onFrameNavigate(e) {
            let url;
            try { url = new URL(e.destination.url); } catch { return; }
            if (keep.exiting) {
                // the rewind's own step back to the blank document; anything else means the exit was abandoned
                if (e.navigationType === 'traverse' && url.href === BLANK && keep.rewinding && !e.userInitiated) {
                    keep.rewinding = false;
                    return;
                }
                abandonExit();
            }
            if (e.hashChange || e.downloadRequest !== null || e.destination.sameDocument) return;
            keep.toBlank = url.href === BLANK;
            keep.going = ''; // one that never committed is overtaken by this one
            if (!/^https?:$/.test(url.protocol)) return;
            if (url.origin !== location.origin) {
                if (e.cancelable) {
                    e.preventDefault();
                    leave(url.href);
                }
                return;
            }
            keep.asked = url.href;
            keep.blocked = false;
            if (keep.lazy && mode === 'closed' && !state.recording && !held() && !e.formData &&
                (e.navigationType === 'push' || e.navigationType === 'replace')) keep.going = url.href;
        }
        /** The next page is somewhere the frame cannot go: the recording ends here and is kept. */
        /** The page's own policy (frame-src) refused this site's next page in the frame: said as that, not as leaving. */
        function onPolicyViolation(e) {
            if (!keep.on || !/^(frame-src|child-src|default-src)$/.test(e.effectiveDirective || e.violatedDirective)) return;
            try { if (new URL(e.blockedURI).origin === location.origin) keep.blocked = true; } catch {}
        }
        function leave(url, reason = 'left') {
            if (!url) return;
            keep.exitTo = url;
            if (state.recording) stopRecording(false, reason);
            else if (mode === 'closed') keepExit();
        }
        function sync() {
            if (!keep.shown) return;
            const url = frameUrl();
            if (!url || url === 'about:blank' || url === BLANK) return;
            if (url !== location.href) history.replaceState(history.state, '', url);
            try {
                const title = keep.frame.contentDocument.title;
                if (title) document.title = keep.frame.title = title;
            } catch {}
        }
        function showFrame() {
            if (keep.shown || !keep.frame) return;
            keep.shown = true;
            const root = document.documentElement;
            const active = document.activeElement;
            keep.saved = {title: document.title, overflow: root.style.overflow, url: location.href,
                active: active && active !== ui.host && active !== document.body && !active.contains(ui.host) ? active : null};
            keep.inert = [...document.body.children].filter(el => el !== keep.layer && el !== layer && !el.contains(ui.host) && !el.inert);
            for (const el of keep.inert) el.inert = true;
            root.style.overflow = 'hidden';
            if (coveredTopLayer()) raiseFrame(); // over the page's own modal dialog or popover
            layerStyle('visibility', 'visible');
            if (mode !== 'dialog') keep.frame.contentWindow.focus(); // typing, and a scanner's, lands in the page shown
        }
        /** Above whatever the covered page has put in the top layer: the frame's dialog is reopened modal, last. */
        function raiseFrame() {
            keep.modal = true;
            if (keep.layer.contains(ui.host)) place('page');
            keep.layer.close();
            keep.layer.showModal();
            if (mode === 'dialog') place('dialog');
            else if (mode === 'pill') place('pill');
        }
        /** The covered page opened a dialog or a popover by itself: the frame goes back above it, with the keyboard. */
        function onCoveredToggle(e) {
            if (!keep.shown || e.newState !== 'open' || !keep.layer) return;
            const t = e.target;
            if (!t.matches || !t.matches(':modal, :popover-open')) return;
            if (t === keep.layer || t === layer || keep.layer.contains(t) || t.contains(ui.host)) return;
            raiseFrame();
            if (mode !== 'dialog') keep.frame.contentWindow.focus();
        }
        function hideFrame() {
            if (!keep.shown) return;
            keep.shown = false;
            layerStyle('visibility', 'hidden');
            if (keep.modal) {
                keep.modal = false;
                if (keep.layer.contains(ui.host)) place('page');
                keep.layer.close();
                keep.layer.show();
                if (mode === 'pill') place('pill');
                else if (mode === 'dialog') place('dialog');
            }
            for (const el of keep.inert) el.inert = false;
            refocus();
            document.documentElement.style.overflow = keep.saved.overflow;
            document.title = keep.saved.title;
            if (location.href !== keep.saved.url) history.replaceState(history.state, '', keep.saved.url);
        }
        /** Typing goes to the page that is shown again, not to the blank frame. */
        function refocus() {
            if (keep.shown || !keep.saved || mode === 'dialog') return;
            // The frame's blank document takes the keyboard when it arrives even though this document's
            // activeElement does not say so: the window is focused again, then what was focused before
            if (keep.frame) keep.frame.blur();
            window.focus();
            const a = keep.saved.active;
            if (a && a.isConnected) {
                a.blur();
                a.focus({preventScroll: true});
            }
        }
        /** Printing while framed prints the framed page: the covered page is left out, the frame as tall as its page. */
        function onBeforePrint() {
            if (!keep.shown || keep.printing) return;
            const root = document.documentElement;
            const saved = keep.printing = {overflow: root.style.overflow, hidden: [], layer: {}, frameHeight: keep.frame.style.height};
            for (const el of document.body.children) {
                if (el === keep.layer || el.style.display === 'none') continue;
                saved.hidden.push([el, el.style.getPropertyValue('display'), el.style.getPropertyPriority('display')]);
                el.style.setProperty('display', 'none', 'important');
            }
            root.style.overflow = '';
            for (const k of ['position', 'height', 'overflow']) saved.layer[k] = keep.layer.style.getPropertyValue(k);
            layerStyle('position', 'static');
            layerStyle('height', 'auto');
            layerStyle('overflow', 'visible');
            let height = 0;
            try { height = keep.frame.contentDocument.documentElement.scrollHeight; } catch {}
            if (height) keep.frame.style.height = height + 'px';
        }
        function onAfterPrint() {
            const saved = keep.printing;
            if (!saved) return;
            keep.printing = null;
            for (const [el, display, priority] of saved.hidden) el.style.setProperty('display', display, priority);
            document.documentElement.style.overflow = saved.overflow;
            for (const [k, v] of Object.entries(saved.layer)) layerStyle(k, v);
            if (keep.frame) keep.frame.style.height = saved.frameHeight;
        }
        /** A framed page is about to go: its errors and requests are copied out, named by its address. */
        function collect(page) {
            if (page.done) return;
            page.done = true;
            try {
                page.url = page.doc.URL || page.url;
                for (const x of page.buffer) keep.journal.push(Object.assign({}, x, {page: page.url}));
                keep.requests.push(...timings(page.perf, page.url, true));
            } catch {}
        }
        /** A page's resource timings as plain entries; a framed page's own load is one of them. */
        function timings(perf, page, withLoad) {
            const out = [];
            if (!perf || !perf.getEntriesByType) return out;
            for (const type of withLoad ? ['navigation', 'resource'] : ['resource']) {
                for (const e of perf.getEntriesByType(type)) {
                    const q = {name: e.name, responseStatus: e.responseStatus, duration: e.duration, at: perf.timeOrigin + e.startTime};
                    if (page) q.page = page;
                    out.push(q);
                }
            }
            return out;
        }
        /** What this document itself holds, since the last report sent while following (it was reported then). */
        const fresh = list => keep.cut ? list.filter(x => x.at >= keep.cut) : list;
        /** The address of this document's own page, the one beneath while the frame is shown. */
        function topUrl() {
            return keep.shown && keep.saved ? keep.saved.url : location.href;
        }
        /** The page the person is on: the framed one while it is shown. */
        function here() {
            return keep.shown && keep.cur && !keep.cur.done ? keep.cur : null;
        }
        /** The errors of every page the walk went through, oldest first; one page's when it never left. */
        function allErrors() {
            const size = core.own.errorBufferSize || 50;
            if (keep.pages.length < 2) return (here() ? here().buffer : fresh(core.buffer)).slice(-size);
            const tag = (list, page) => list.map(x => Object.assign({}, x, {page}));
            let list = tag(fresh(core.buffer), topUrl()).concat(keep.journal);
            if (here()) list = list.concat(tag(here().buffer, here().doc.URL));
            return list.sort((a, b) => a.at - b.at).slice(-size);
        }

        // ---- What the stub calls

        function setContext(key, value) {
            const [fallback, check, rule] = RULES[key];
            const checked = check(value);
            if (checked === undefined) warn(`setContext(): "${key}" must be ${rule}; it is left out of the report`);
            context[key] = checked === undefined ? fallback : checked;
            if (mode === 'dialog') render();
        }
        function reset() {
            generation++; // every async step started before now finds itself out of date
            discard();
            dropDraft();
            forgetWalk();
            keep.cut = Date.now(); // what was requested before the reset is not reported after it
            if (mode === 'pill' || mode === 'capturing' || mode === 'dialog') {
                mode = 'dialog';
                close(true);
            }
            if (ui) render();
        }
        // A framed page's stub reaches the one panel through these
        hub.frame = adopt;
        hub.open = trigger => open(trigger);
        hub.close = () => close();
        hub.reset = reset;
        hub.setContext = setContext;
        return {open, close: () => close(), setContext, reset};
    }

    // Last, once every declaration above is initialized
    hub.webmWithDuration = webmWithDuration; // for the widget's own tests
    hub.attach(VERSION, core => {
        const major = v => String(v).split('.')[0];
        if (major(core.version) !== major(VERSION)) {
            const say = typeof core.say === 'function' ? core.say : (kind, m) => console.error('feedback: ' + m);
            say('error', `the panel is version ${VERSION} and the stub is ${core.version}; ` +
                'deploy feedback.js and feedbackPanel.js from the same release. The panel will not open.');
            return null;
        }
        if (!('adoptedStyleSheets' in Document.prototype)) {
            core.say('error', 'this browser has no constructable stylesheets, so the panel cannot open');
            return null;
        }
        return createPanel(core);
    });
})();
