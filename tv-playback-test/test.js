/*
 * Playback test for the TV-only version of the app. Each test shows PASS/FAIL so
 * the results can be read off the screen. Written in ES5 for Tizen 5.0.
 */
var API = 'https://animehot.cc/api';
var TEST_SLUG = "my-status-as-an-assassin-obviously-exceeds-the-hero's-mn1d1u";
var ZOKO_KEY = 'otaku-embed-v1';

var links = null;   // { zoko: url, mega: url } for episode 1 (sub)
var m3u8 = null;    // stream URL decoded from the zokoanime page
var subUrl = null;  // first subtitle (.vtt) URL from the same page
// The video host only answers requests with this Referer. Browsers can't set it, but
// AVPlay copies its COOKIE property into the request headers verbatim, so a CRLF in
// the value adds a header line (also works with USER_AGENT).
var REFERER = 'https://zokoanime.video/';
var running = null; // { stop: fn, confirm: fn } for the test on screen
var focusIdx = 0;

var TESTS = [
    { name: 'Catalog API reachable from the TV', run: testCatalog },
    { name: 'Read stream link from zokoanime page', run: testDecode },
    { name: 'Fetch stream playlist directly (no Referer)', run: testFetchPlaylist },
    { name: 'Play stream with Samsung AVPlay', run: testAvplay },
    { name: 'zokoanime player inside the app', run: function (done) { testIframe('zoko', done); } },
    { name: 'megaplay player inside the app', run: function (done) { testIframe('mega', done); } },
    { name: 'Subtitles via Tizen download (with Referer)', run: testSubtitles }
];

function $(id) { return document.getElementById(id); }

function log(msg) {
    var el = $('log');
    el.textContent = (new Date().toTimeString().slice(0, 8)) + '  ' + msg + '\n' + el.textContent;
}

function setResult(i, cls, text) {
    var r = document.querySelectorAll('.test .res')[i];
    r.className = 'res ' + cls;
    r.textContent = text || cls;
}

function xhr(url, cb, method, body) {
    var x = new XMLHttpRequest();
    x.open(method || 'GET', url, true);
    x.timeout = 15000;
    if (body) x.setRequestHeader('Content-Type', 'application/json');
    x.onload = function () { cb(x.status, x.responseText); };
    x.onerror = function () { cb(0, 'network error (likely blocked by CORS)'); };
    x.ontimeout = function () { cb(0, 'timeout'); };
    x.send(body || null);
}

function getLinks(cb) {
    if (links) { cb(links); return; }
    xhr(API + '/anime/' + encodeURIComponent(TEST_SLUG), function (st, txt) {
        var a = null;
        try { a = JSON.parse(txt).anime; } catch (e) { /* handled below */ }
        var ep = a && a.episodes && a.episodes[0];
        var sub = ep && ep.link && ep.link.sub || [];
        links = { zoko: null, mega: null };
        for (var i = 0; i < sub.length; i++) {
            if (sub[i].indexOf('zokoanime') >= 0) links.zoko = sub[i];
            if (sub[i].indexOf('megaplay') >= 0) links.mega = sub[i];
        }
        log('episode links: ' + JSON.stringify(links));
        cb(links);
    });
}

/* 1 */
function testCatalog(done) {
    xhr(API + '/anime/trending', function (st, txt) {
        var n = 0;
        try { n = JSON.parse(txt).animes.length; } catch (e) { /* not JSON */ }
        log('catalog: HTTP ' + st + ', ' + n + ' anime');
        done(n > 0, n > 0 ? n + ' anime' : 'HTTP ' + st);
    });
}

function zokoDecode(html) {
    var m = /window\.__P="([^"]+)"/.exec(html);
    if (!m) return null;
    var raw = atob(m[1]), out = '';
    for (var i = 0; i < raw.length; i++) {
        out += String.fromCharCode(raw.charCodeAt(i) ^ ZOKO_KEY.charCodeAt(i % ZOKO_KEY.length));
    }
    return JSON.parse(decodeURIComponent(escape(out)));
}

/* 2 */
function testDecode(done) {
    getLinks(function (l) {
        if (!l.zoko) { done(false, 'no zoko link'); return; }
        xhr(l.zoko, function (st, html) {
            var d = null;
            try { d = zokoDecode(html); } catch (e) { log('decode error: ' + e); }
            if (d && d.src) {
                m3u8 = d.src;
                subUrl = d.subtitles && d.subtitles[0] && d.subtitles[0].src;
                log('stream: ' + d.src);
                done(true, 'got link');
            } else {
                log('embed page: HTTP ' + st + ', ' + String(html).slice(0, 120));
                done(false, 'HTTP ' + st);
            }
        });
    });
}

/* 3 */
function testFetchPlaylist(done) {
    if (!m3u8) { done(false, 'run test 2 first'); return; }
    xhr(m3u8, function (st, txt) {
        log('playlist: HTTP ' + st + ' ' + String(txt).slice(0, 60).replace(/\n/g, ' '));
        done(st === 200 && txt.indexOf('#EXTM3U') === 0, 'HTTP ' + st);
    });
}

function stage(on) { $('stage').className = on ? 'on' : ''; }
function hud(text) { var h = $('hud'); h.className = text ? 'on' : ''; h.innerHTML = text || ''; }

/* 4 */
function testAvplay(done) {
    if (!m3u8) { done(false, 'run test 2 first'); return; }
    if (typeof webapis === 'undefined' || !webapis.avplay) { done(false, 'no AVPlay'); return; }
    var av = webapis.avplay, last = 0, finished = false;
    function finish(ok, msg) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { av.stop(); av.close(); } catch (e) { /* already closed */ }
        stage(false); hud('');
        running = null;
        done(ok, msg);
    }
    var timer = setTimeout(function () { finish(false, 'no playback in 30s'); }, 30000);
    running = { stop: function () { finish(false, 'stopped'); } };
    stage(true);
    hud('Testing AVPlay… (Back to cancel)');
    try {
        av.open(m3u8);
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setStreamingProperty('COOKIE', 'a=1\r\nReferer: ' + REFERER);
        av.setListener({
            oncurrentplaytime: function (ms) {
                last = ms;
                hud('AVPlay playing: ' + Math.round(ms / 1000) + 's');
                if (ms > 4000) finish(true, 'plays');
            },
            onerror: function (e) { log('AVPlay error: ' + e); finish(false, String(e)); },
            onbufferingstart: function () {}, onbufferingcomplete: function () {},
            onstreamcompleted: function () {}, onevent: function () {}
        });
        av.prepareAsync(function () { av.play(); }, function (e) { log('AVPlay prepare failed: ' + e); finish(false, 'prepare: ' + e); });
    } catch (e) {
        log('AVPlay exception: ' + e);
        finish(false, String(e));
    }
}

/* 7 */
function testSubtitles(done) {
    if (!subUrl) { done(false, 'run test 2 first'); return; }
    if (typeof tizen === 'undefined' || !tizen.download) { done(false, 'no download API'); return; }
    var name = 'sub' + Date.now() + '.vtt';
    var req = new tizen.DownloadRequest(subUrl, 'wgt-private-tmp', name, 'ALL', { Referer: REFERER });
    tizen.download.start(req, {
        oncompleted: function (id, path) {
            log('subtitle saved: ' + path);
            tizen.filesystem.resolve('wgt-private-tmp/' + name, function (f) {
                f.readAsText(function (txt) {
                    var cues = (txt.match(/-->/g) || []).length;
                    log('subtitle: ' + cues + ' cues, ' + txt.slice(0, 80).replace(/\n/g, ' '));
                    done(txt.indexOf('WEBVTT') === 0 && cues > 0, cues + ' cues');
                }, function (e) { done(false, 'read: ' + e.message); }, 'UTF-8');
            }, function (e) { done(false, 'resolve: ' + e.message); }, 'r');
        },
        onfailed: function (id, e) { log('download failed: ' + e.name + ' ' + e.message); done(false, e.name); }
    });
}

/* 5, 6 */
function testIframe(which, done) {
    getLinks(function (l) {
        var url = l[which];
        if (!url) { done(false, 'no link'); return; }
        var frame = document.createElement('iframe');
        frame.setAttribute('allow', 'autoplay; fullscreen');
        frame.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'autoplay=true';
        var events = 0, lastTime = 0, finished = false;
        function onMsg(e) {
            var d = e.data;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (err) { d = { raw: d }; } }
            events++;
            var t = d && (d.time || d.currentTime || d.position);
            if (typeof t === 'number') lastTime = t;
            if (events <= 5) log(which + ' message: ' + JSON.stringify(d).slice(0, 140));
            hud(prompt());
        }
        function prompt() {
            return which + ' player — messages from player: ' + events +
                (lastTime ? ', time ' + Math.round(lastTime) + 's' : '') +
                '<br>Is video playing? <b>OK = yes</b> · <b>Back = no</b>';
        }
        function finish(ok, msg) {
            if (finished) return;
            finished = true;
            window.removeEventListener('message', onMsg);
            if (frame.parentNode) frame.parentNode.removeChild(frame);
            stage(false); hud('');
            running = null;
            done(ok, msg + (events ? ' (' + events + ' msgs)' : ''));
            // Keep keys on our page, not inside the removed frame.
            window.focus();
        }
        window.addEventListener('message', onMsg);
        $('stage').appendChild(frame);
        stage(true);
        hud(prompt());
        if (which === 'zoko') {
            // Ask the player to start, through its control bridge.
            setTimeout(function () {
                try { frame.contentWindow.postMessage({ channel: 'zokoanime', type: 'play' }, '*'); } catch (e) { log('postMessage failed: ' + e); }
            }, 6000);
        }
        // The frame must not keep focus, or the remote's keys go to it.
        setInterval(function () { if (!finished && document.activeElement === frame) frame.blur(); }, 500);
        running = {
            stop: function () { finish(false, 'not playing'); },
            confirm: function () { finish(true, 'plays'); }
        };
    });
}

/* ---------------------------------------------------------------- UI */
function render() {
    var box = $('tests');
    for (var i = 0; i < TESTS.length; i++) {
        var row = document.createElement('div');
        row.className = 'test';
        row.innerHTML = '<span class="num">' + (i + 1) + '</span><span class="name">' + TESTS[i].name +
            '</span><span class="res WAIT">not run</span>';
        box.appendChild(row);
    }
    focus(0);
}

function focus(i) {
    var rows = document.querySelectorAll('.test');
    focusIdx = (i + rows.length) % rows.length;
    for (var k = 0; k < rows.length; k++) rows[k].className = 'test' + (k === focusIdx ? ' focused' : '');
}

function runTest(i) {
    if (running) return;
    setResult(i, 'RUN', 'running…');
    TESTS[i].run(function (ok, msg) {
        setResult(i, ok ? 'PASS' : 'FAIL', (ok ? 'PASS' : 'FAIL') + (msg ? ' · ' + msg : ''));
    });
}

document.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (running) {
        if (k === 13 && running.confirm) running.confirm();
        else if (k === 10009 || k === 27 || k === 8) running.stop();
        e.preventDefault();
        return;
    }
    if (k === 38) focus(focusIdx - 1);
    else if (k === 40) focus(focusIdx + 1);
    else if (k === 13) runTest(focusIdx);
    else if (k >= 49 && k <= 48 + TESTS.length) runTest(k - 49);
    else if (k === 10009) { try { tizen.application.getCurrentApplication().exit(); } catch (err) { /* desktop */ } }
    else return;
    e.preventDefault();
}, true);

window.onload = function () {
    var m = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
    $('ua').textContent = 'Browser engine: Chromium ' + (m ? m[1] : '?') + ' · ' +
        (typeof webapis !== 'undefined' && webapis.avplay ? 'AVPlay available' : 'no AVPlay (not a Samsung TV)') +
        ' · Run tests 1 → 7 in order (Up/Down + OK, or number keys).';
    log(navigator.userAgent);
    render();
};
