/*! feedback 1.2.0 stub: error buffer, trigger, panel loader. See README.md */
(() => {
    'use strict';
    const VERSION = '1.2.0';
    const HUB = Symbol.for('feedback.stub');
    const con = console;
    const original = {error: con.error, warn: con.warn};
    const say = (kind, m) => original[kind].call(con, 'feedback: ' + m);
    const warn = m => say('warn', m);
    const bad = k => warn(`"${k}" is not valid; the default is used`);
    const isObject = v => v && typeof v == 'object' && !Array.isArray(v);
    const get = (o, k) => isObject(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
    const cut = (s, n) => s && String(s).slice(0, n).replace(/[\uD800-\uDBFF]$/, '');
    const KEYS = ('endpoint project environment release context user credentials headers fields timeoutMs types ' +
        'defaultType messageMaxLength labels locale trigger launcher zIndex theme collect errorBufferSize requestCount ' +
        'scrubParams scrubPatterns screenshot anySurface video panelSrc panelIntegrity beforeSend onOpen onSent onError').split(' ');

    // a real <script>: <img name=currentScript> clobbers it
    const tag = document.currentScript instanceof HTMLScriptElement ? document.currentScript : null;
    const signature = tag ? JSON.stringify(Object.entries(tag.dataset)) : '';
    if (window[HUB]) { // loaded twice: the first copy is in charge
        if (window[HUB].a != signature) say('error', 'loaded twice with different settings; the copy that ran first is in charge');
        return;
    }
    // own keys, in null-prototype objects: pollution is never a setting
    const attrs = Object.create(null), given = Object.create(null), pending = Object.create(null), own = Object.create(null);
    const unknown = k => warn('unknown setting ' + k);
    if (tag) for (const k of Object.keys(tag.dataset)) KEYS.includes(k) ? attrs[k] = tag.dataset[k] : unknown('data-' + k);

    const pick = (k, text) => {
        if (k in given) return given[k];
        if (!(k in attrs)) return;
        if (text) return attrs[k];
        try { return JSON.parse(attrs[k]); } catch { bad('data-' + k); }
    };
    // https: or this origin (local: this origin only), never against a <base>
    const place = (k, v, local) => {
        try {
            const u = new URL(v, location.href);
            if (u.origin == location.origin || !local && u.protocol == 'https:') return u.href;
        } catch {}
        bad(k);
    };
    const sized = v => v === undefined ? 50 : Number.isInteger(v) && v > 0 && v <= 100 ? v : (bad('errorBufferSize'), 50);

    const buffer = [];
    let size = sized(pick('errorBufferSize')), off, busy, frozen, panel, loading, opener, above, policy;
    // in a recording's frame the widget above has the panel
    try { above = top != self && top[HUB]; above = above && above.frame && above.frame(self, buffer) && above; } catch {}
    const text = v => { // JSON, within a budget
        try {
            if (!isObject(v) || v instanceof Error) return String(v);
            let n = 0;
            return JSON.stringify(v, (k, x) => { if (++n > 300) throw 0; return x; });
        } catch { return '[object]'; }
    };
    const push = (kind, message, source, line, column, stack) => {
        if (off) return;
        const entry = {kind, message: cut(message, 500), source: cut(source, 2000), line, column,
            stack: cut(stack, 2000), at: Date.now(), count: 1};
        const key = [kind, entry.message, entry.source, line, column].join('\n');
        const last = buffer[buffer.length - 1];
        if (last && last.key == key) return last.count++;
        Object.defineProperty(entry, 'key', {value: key});
        if (buffer.push(entry) > size) buffer.shift();
    };
    for (const kind of ['error', 'warn']) {
        const next = con[kind];
        con[kind] = function (...args) {
            const result = next.apply(this, args); // the original first; never throws
            if (!busy) {
                busy = 1;
                try {
                    let stack;
                    try { stack = args.find(a => a instanceof Error).stack; } catch {}
                    push('console.' + kind, args.map(text).join(' '), 0, 0, 0, stack);
                } catch {}
                busy = 0;
            }
            return result;
        };
    }
    const onError = e => {
        const t = e.target, url = t && (t.currentSrc || t.src || t.href);
        if (t && t.nodeType == 1) push('resource', `Failed to load ${t.localName} ${url || ''}`, url);
        else push('exception', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
    };
    const onRejection = e => {
        try { push('rejection', text(e.reason), 0, 0, 0, e.reason && e.reason.stack); } catch {}
    };
    const onClick = e => {
        let t;
        try { // the path, so a trigger in a shadow root counts
            const selector = own.trigger || pick('trigger', 1) || '[data-feedback]';
            t = e.composedPath().find(n => n.matches && n.matches(selector));
        } catch {}
        if (t) {
            e.preventDefault();
            open(t);
        }
    };
    addEventListener('error', onError, true); // capturing: failed loads too
    addEventListener('unhandledrejection', onRejection);
    document.addEventListener('click', onClick);

    // settings freeze at init(), first open or load
    const freeze = () => {
        if (frozen) return;
        frozen = 1;
        const endpoint = pick('endpoint', 1);
        // another origin only from init(): injected markup can write attributes
        own.endpoint = endpoint && place('endpoint', endpoint, !('endpoint' in given));
        if (!endpoint) warn('no "endpoint" is set, so the widget is off' + (tag ? '' : ' (no data- attributes read: a module script has none)'));
        if (!own.endpoint) {
            off = 1;
            buffer.length = 0;
            removeEventListener('error', onError, true);
            removeEventListener('unhandledrejection', onRejection);
            return document.removeEventListener('click', onClick);
        }
        if ('errorBufferSize' in given) buffer.splice(0, buffer.length - (size = sized(given.errorBufferSize)));
        own.errorBufferSize = size;
        const t = pick('trigger', 1);
        own.trigger = '[data-feedback]';
        try {
            document.documentElement.matches(t || ':');
            own.trigger = t;
        } catch { t === undefined || bad('trigger'); }
        const sri = pick('panelIntegrity', 1);
        const sriBad = sri !== undefined && !/^(sha(256|384|512)-[\w+/]+=* ?)+$/.test(sri);
        own.panelIntegrity = sriBad ? bad('panelIntegrity') : sri; // and no panel without it
        // beside the stub, with its ?v=; elsewhere needs panelIntegrity
        const src = pick('panelSrc', 1) || tag && tag.src && new URL('feedbackPanel.js' + new URL(tag.src).search, tag.src).href;
        own.panelSrc = !sriBad && src && place('panelSrc', src);
        if (own.panelSrc && !own.panelIntegrity && new URL(own.panelSrc).origin != location.origin) own.panelSrc = bad('panelSrc');
        let l = pick('launcher');
        if (l === true) l = {};
        const position = '' + (get(l, 'position') || 'bottom-right'), z = pick('zIndex');
        if (l && !/^(top|bottom)-(left|right)$/.test(position)) l = bad('launcher');
        if (l && !above) {
            const b = document.createElement('button');
            const [y, x] = position.split('-');
            b.type = 'button';
            b.textContent = cut(get(l, 'label') || get(pick('labels'), 'launcher') || 'Feedback', 40);
            Object.assign(b.style, { // CSSOM, which a strict style-src allows
                position: 'fixed', [y]: '16px', [x]: '16px', zIndex: Number.isInteger(z) && z >= 0 && z < 2 ** 31 ? z : 2147483000,
                font: '500 14px var(--feedback-font, system-ui, sans-serif)', padding: '12px 16px', border: 0,
                color: 'var(--feedback-accent-text, #fff)', background: 'var(--feedback-accent, #2563eb)', borderRadius: '99px', cursor: 'pointer'
            });
            b.onclick = () => open(b);
            const draw = () => document.body.append(b);
            document.body ? draw() : addEventListener('DOMContentLoaded', draw, {once: true});
        }
    };

    const open = t => {
        if (above) return above.open(t || document.activeElement);
        freeze();
        if (off) return;
        opener = t || document.activeElement;
        if (panel) return panel.open(opener);
        if (loading || panel === null) return;
        if (!own.panelSrc) return say('error', 'there is no panel to load: see panelSrc and panelIntegrity');
        const s = document.createElement('script');
        // Trusted Types: one policy, feedback, giving only the panel's address
        try { policy = policy || window.trustedTypes && trustedTypes.createPolicy('feedback', {createScriptURL: () => own.panelSrc, createHTML: () => '<!doctype html><title></title>'}); } catch {}
        try { s.src = policy ? policy.createScriptURL('') : own.panelSrc; }
        catch { return say('error', 'Trusted Types refused the panel: allow the policy "feedback"'); }
        s.nonce = tag && tag.nonce || '';
        if (own.panelIntegrity) {
            s.integrity = own.panelIntegrity;
            s.crossOrigin = 'anonymous';
        }
        s.onerror = () => {
            loading = 0;
            s.remove();
            say('error', 'could not load ' + own.panelSrc);
        };
        loading = 1;
        document.head.append(s);
    };

    window[HUB] = {
        a: signature,
        attach(version, make) { // only while loading; the panel checks the version
            if (panel !== undefined || !loading) return;
            loading = 0;
            panel = make({version: VERSION, src: tag && tag.src, tt: policy, attrs, given, own, pending, buffer, say}) || null;
            if (panel && opener !== 0) panel.open(opener);
        }
    };
    window.feedback = {
        version: VERSION,
        init(o) {
            if (frozen) return warn('init() came after the settings froze; ignored');
            if (!isObject(o)) return bad('init');
            for (const k of Object.keys(o)) KEYS.includes(k) ? given[k] = o[k] : unknown(k);
            freeze();
        },
        open() { open(); },
        close() { (above || panel) && (above || panel).close(); },
        setContext(o) {
            if (!isObject(o)) return bad('setContext');
            for (const k of Object.keys(o)) {
                if (k != 'user' && k != 'context') unknown(k);
                else if (above || panel) (above || panel).setContext(k, o[k]);
                else pending[k] = o[k];
            }
        },
        reset() {
            buffer.length = 0;
            own.cut = Date.now(); // no request from before is reported
            opener = 0; // a loading panel does not open
            try { sessionStorage.removeItem('feedback.draft'); } catch {}
            (above || panel) && (above || panel).reset();
        }
    };
    if (document.readyState != 'complete') addEventListener('load', freeze, {once: true});
})();
