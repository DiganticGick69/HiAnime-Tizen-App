/*
 * Full-screen player. Uses Samsung AVPlay on the TV (hardware HLS decoding) and
 * falls back to <video> + hls.js when previewing in a desktop browser (which can't
 * send the Referer the video host wants, so desktop preview won't play).
 */
var Engines = {
    /* Samsung AVPlay — the TV's native player. */
    av: function () {
        var av = webapis.avplay;
        var handlers = {};
        var dur = 0, cur = 0, paused = false;
        return {
            name: 'avplay',
            on: function (h) { handlers = h; },
            load: function (url, startSec, referer) {
                try { av.stop(); av.close(); } catch (e) { /* nothing open */ }
                cur = startSec || 0; paused = false;
                av.open(url);
                av.setDisplayRect(0, 0, 1920, 1080);
                av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
                // AVPlay has no header API, but it copies USER_AGENT into the request as-is,
                // so a CRLF adds the Referer line the video host checks (verified on Tizen 5.0).
                if (referer) av.setStreamingProperty('USER_AGENT', navigator.userAgent + '\r\nReferer: ' + referer);
                av.setListener({
                    onbufferingstart: function () { if (handlers.buffering) handlers.buffering(true); },
                    onbufferingcomplete: function () { if (handlers.buffering) handlers.buffering(false); },
                    oncurrentplaytime: function (ms) { cur = ms / 1000; if (handlers.time) handlers.time(cur); },
                    onstreamcompleted: function () { if (handlers.ended) handlers.ended(); },
                    onerror: function (err) { if (handlers.error) handlers.error(String(err)); },
                    onevent: function () {}
                });
                av.prepareAsync(function () {
                    dur = av.getDuration() / 1000;
                    var go = function () { av.play(); if (handlers.ready) handlers.ready(); };
                    if (startSec > 1) av.seekTo(Math.floor(startSec * 1000), go, go);
                    else go();
                }, function (err) { if (handlers.error) handlers.error(String(err)); });
            },
            play: function () { try { av.play(); paused = false; } catch (e) { /* not ready */ } },
            pause: function () { try { av.pause(); paused = true; } catch (e) { /* not ready */ } },
            paused: function () { return paused; },
            seek: function (sec) {
                sec = Math.max(0, Math.min(sec, dur - 2));
                try { av.seekTo(Math.floor(sec * 1000)); cur = sec; } catch (e) { /* seeking while buffering */ }
            },
            time: function () { return cur; },
            duration: function () { return dur || av.getDuration() / 1000 || 0; },
            stop: function () { try { av.stop(); av.close(); } catch (e) { /* already closed */ } },
            suspend: function () { try { av.suspend(); } catch (e) { /* ignore */ } },
            restore: function () { try { av.restore(); } catch (e) { /* ignore */ } }
        };
    },

    /* Desktop preview fallback. */
    html: function () {
        var v = document.getElementById('html-player');
        var hls = null, handlers = {};
        v.classList.remove('hidden');
        document.getElementById('av-player').classList.add('hidden');
        function attach(url, startSec) {
            if (hls) { hls.destroy(); hls = null; }
            v.onloadedmetadata = function () {
                if (startSec > 1) v.currentTime = startSec;
                v.play();
                if (handlers.ready) handlers.ready();
            };
            if (v.canPlayType('application/vnd.apple.mpegurl')) { v.src = url; return; }
            loadHlsJs(function () {
                hls = new Hls();
                hls.on(Hls.Events.ERROR, function (e, d) { if (d.fatal && handlers.error) handlers.error(d.details); });
                hls.loadSource(url);
                hls.attachMedia(v);
            });
        }
        v.ontimeupdate = function () { if (handlers.time) handlers.time(v.currentTime); };
        v.onended = function () { if (handlers.ended) handlers.ended(); };
        v.onwaiting = function () { if (handlers.buffering) handlers.buffering(true); };
        v.onplaying = function () { if (handlers.buffering) handlers.buffering(false); };
        return {
            name: 'html5',
            on: function (h) { handlers = h; },
            load: attach,
            play: function () { v.play(); },
            pause: function () { v.pause(); },
            paused: function () { return v.paused; },
            seek: function (sec) { v.currentTime = Math.max(0, Math.min(sec, (v.duration || 0) - 2)); },
            time: function () { return v.currentTime; },
            duration: function () { return v.duration || 0; },
            stop: function () { if (hls) { hls.destroy(); hls = null; } v.removeAttribute('src'); v.load(); },
            suspend: function () { v.pause(); },
            restore: function () {}
        };
    }
};

function loadHlsJs(cb) {
    if (window.Hls) { cb(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js';
    s.onload = cb;
    document.head.appendChild(s);
}

var Player = (function () {
    var root, osd, subBox, spinner, nextUp;
    var engine = null;
    var state = null;      // {anime, episode, lang, server, servers, cues, ccOn}
    var osdTimer = null, saveTimer = null, nextTimer = null;
    var cueIdx = 0;
    var active = false;
    var prevScope = null, prevFocus = null;
    var lastSaved = 0;

    function $(sel) { return root.querySelector(sel); }

    function init() {
        root = document.getElementById('player');
        osd = document.getElementById('player-osd');
        subBox = document.getElementById('subtitle-box');
        spinner = document.getElementById('player-spinner');
        nextUp = document.getElementById('next-up');
        var btns = root.querySelectorAll('.focusable');
        for (var i = 0; i < btns.length; i++) {
            (function (b) { b._enter = function () { action(b.getAttribute('data-act')); }; })(btns[i]);
        }
        document.addEventListener('visibilitychange', function () {
            if (!active || !engine) return;
            if (document.hidden) { save(true); engine.suspend(); }
            else engine.restore();
        });
    }

    function makeEngine() {
        if (engine) return engine;
        engine = (typeof webapis !== 'undefined' && webapis.avplay) ? Engines.av() : Engines.html();
        engine.on({
            ready: function () { busy(false); showOsd(); },
            time: onTime,
            ended: onEnded,
            buffering: function (b) { spinner.classList.toggle('hidden', !b); },
            error: function (msg) {
                busy(false);
                UI.toast('Playback error (' + msg + '). Trying another server…', 4000);
                if (state && state.servers > 1 && !state.retried) {
                    state.retried = true;
                    switchServer();
                }
            }
        });
        return engine;
    }

    function episodeInfo(n) {
        var list = state.anime.episodeList || [];
        for (var i = 0; i < list.length; i++) if (list[i].number === n) return { ep: list[i], idx: i };
        return null;
    }

    function busy(on, msg) {
        spinner.classList.toggle('hidden', !on);
        var m = root.querySelector('.loading-msg');
        if (on) {
            if (!m) { m = UI.h('div', 'loading-msg'); root.appendChild(m); }
            m.textContent = msg || '';
        } else if (m) m.parentNode.removeChild(m);
    }

    /* opts: {anime, episode, lang, startAt} */
    function open(opts) {
        App.rememberFocus();
        prevScope = document.getElementById('view');
        prevFocus = Nav.current();
        active = true;
        root.classList.remove('hidden');
        document.getElementById('sidebar').classList.add('hidden');
        Nav.setScope(root);
        state = { anime: opts.anime, episode: opts.episode, lang: opts.lang || 'sub', server: 0, servers: 1, cues: [], ccOn: true };
        makeEngine();
        start(opts.startAt || 0);
    }

    function start(startAt) {
        clearNextUp();
        subBox.textContent = '';
        state.cues = []; cueIdx = 0;
        var info = episodeInfo(state.episode);
        if (info) {
            var ep = info.ep;
            if (state.lang === 'dub' && !ep.hasDub) state.lang = 'sub';
            if (state.lang === 'sub' && !ep.hasSub && ep.hasDub) state.lang = 'dub';
        }
        $('.osd-title').textContent = state.anime.title;
        $('.osd-sub').textContent = 'Episode ' + state.episode + ' · ' + state.lang.toUpperCase();
        $('[data-act="lang"]').textContent = state.lang === 'sub' ? 'SUB' : 'DUB';
        busy(true, 'Finding stream…');
        var token = state.token = {};
        Api.stream(state.anime.slug, state.episode, state.lang, state.server).then(function (s) {
            if (token !== state.token || !active) return;
            state.server = s.server; state.servers = s.servers;
            $('[data-act="server"]').textContent = 'Server ' + (s.server + 1);
            $('[data-act="server"]').classList.toggle('hidden', s.servers < 2);
            loadSubs(s.subtitles || [], s.referer);
            busy(true, 'Loading video…');
            engine.load(s.url, startAt, s.referer);
            if (saveTimer) clearInterval(saveTimer);
            saveTimer = setInterval(function () { save(false); }, 10000);
        }).catch(function (e) {
            if (token !== state.token) return;
            busy(false);
            UI.toast(e.message, 5000);
            showOsd(true);
        });
    }

    function loadSubs(tracks, referer) {
        var cc = $('[data-act="cc"]');
        cc.classList.toggle('hidden', !tracks.length);
        if (!tracks.length) return;
        var token = state.token;
        Api.subtitles(tracks[0].url, referer).then(function (d) {
            if (!state || token !== state.token) return;
            state.cues = (d && d.cues) || [];
            cueIdx = 0;
        }).catch(function () { cc.classList.add('hidden'); });
        cc.classList.toggle('off', !state.ccOn);
    }

    var lastT = -1;
    function onTime(t) {
        // Time moving means we're playing, whatever the buffering events said.
        if (t !== lastT && lastT >= 0) spinner.classList.add('hidden');
        lastT = t;
        updateOsd(t);
        if (!state.ccOn || !state.cues.length) { if (subBox.textContent) subBox.textContent = ''; return; }
        var cues = state.cues;
        if (cueIdx >= cues.length || cues[cueIdx].start > t) cueIdx = 0;
        while (cueIdx < cues.length && cues[cueIdx].end < t) cueIdx++;
        var c = cues[cueIdx];
        var txt = c && c.start <= t && c.end >= t ? c.text : '';
        if (subBox.textContent !== txt) subBox.textContent = txt;
    }

    function updateOsd(t) {
        if (!root.classList.contains('osd-on')) return;
        var d = engine.duration();
        var pct = d ? Math.min(100, 100 * t / d) : 0;
        $('.osd-fill').style.width = pct + '%';
        $('.osd-knob').style.left = pct + '%';
        $('.osd-cur').textContent = UI.fmtTime(t);
        $('.osd-dur').textContent = '-' + UI.fmtTime(Math.max(0, d - t));
        var play = $('[data-act="toggle"] .ico');
        var want = engine.paused() ? 'play' : 'pause';
        if (play.getAttribute('data-icon') !== want) { play.setAttribute('data-icon', want); play.innerHTML = icon(want); }
    }

    function showOsd(sticky) {
        root.classList.add('osd-on');
        var cur = Nav.current();
        if (!cur || !root.contains(cur)) Nav.focus($('[data-act="toggle"]'));
        updateOsd(engine ? engine.time() : 0);
        clearTimeout(osdTimer);
        if (!sticky) osdTimer = setTimeout(function () {
            if (engine && !engine.paused()) root.classList.remove('osd-on');
        }, 5000);
    }

    function hideOsd() { clearTimeout(osdTimer); root.classList.remove('osd-on'); }

    function save(force) {
        if (!state || !engine) return;
        var t = engine.time(), d = engine.duration();
        if (!d || t < 5) return;
        if (!force && Math.abs(t - lastSaved) < 5) return;
        lastSaved = t;
        Api.progress({ slug: state.anime.slug, episode: state.episode, lang: state.lang, position: t, duration: d })
            .catch(function () { /* offline: next save will retry */ });
    }

    function neighbour(step) {
        var info = episodeInfo(state.episode);
        if (!info) return null;
        var list = state.anime.episodeList;
        var n = list[info.idx + step];
        return n || null;
    }

    function playEpisode(ep, startAt) {
        save(true);
        state.episode = ep.number;
        state.retried = false;
        start(startAt || 0);
    }

    function onEnded() {
        var d = engine.duration();
        Api.progress({ slug: state.anime.slug, episode: state.episode, lang: state.lang, position: d, duration: d }).catch(function () {});
        var n = neighbour(1);
        if (!n) { UI.toast('You finished ' + state.anime.title + '!'); close(); return; }
        var left = 8;
        nextUp.classList.remove('hidden');
        var tick = function () {
            nextUp.innerHTML = 'Up next: <b>Episode ' + n.number + '</b> in ' + left + 's<br><small>OK to play now · Back to cancel</small>';
            if (left-- <= 0) { clearNextUp(); playEpisode(n); }
        };
        tick();
        nextTimer = setInterval(tick, 1000);
        state.pendingNext = n;
    }

    function clearNextUp() {
        if (nextTimer) clearInterval(nextTimer);
        nextTimer = null;
        nextUp.classList.add('hidden');
        if (state) state.pendingNext = null;
    }

    function switchServer() {
        if (state.servers < 2) return;
        var t = engine.time();
        state.server = (state.server + 1) % state.servers;
        start(t);
    }

    function action(act) {
        showOsd();
        if (act === 'toggle') { if (engine.paused()) engine.play(); else engine.pause(); save(true); }
        else if (act === 'back10') engine.seek(engine.time() - 10);
        else if (act === 'fwd10') engine.seek(engine.time() + 10);
        else if (act === 'next') { var n = neighbour(1); if (n) playEpisode(n); else UI.toast('This is the last episode'); }
        else if (act === 'prev') { var p = neighbour(-1); if (p) playEpisode(p); else UI.toast('This is the first episode'); }
        else if (act === 'lang') {
            var info = episodeInfo(state.episode);
            var want = state.lang === 'sub' ? 'dub' : 'sub';
            if (info && ((want === 'dub' && !info.ep.hasDub) || (want === 'sub' && !info.ep.hasSub))) {
                UI.toast((want === 'dub' ? 'Dub' : 'Sub') + ' is not available for this episode');
                return;
            }
            var t = engine.time();
            save(true);
            state.lang = want; state.server = 0; state.retried = false;
            start(t);
        }
        else if (act === 'cc') {
            state.ccOn = !state.ccOn;
            $('[data-act="cc"]').classList.toggle('off', !state.ccOn);
            if (!state.ccOn) subBox.textContent = '';
        }
        else if (act === 'server') { save(true); state.retried = false; switchServer(); }
        updateOsd(engine.time());
    }

    function close() {
        save(true);
        active = false;
        clearNextUp();
        clearInterval(saveTimer); saveTimer = null;
        hideOsd();
        if (state) state.token = null;
        if (engine) engine.stop();
        root.classList.add('hidden');
        document.getElementById('sidebar').classList.remove('hidden');
        subBox.textContent = '';
        busy(false);
        Nav.setScope(document);
        var anime = state && state.anime;
        state = null;
        App.afterPlayer(anime, prevFocus);
    }

    function handleKey(code) {
        var osdOn = root.classList.contains('osd-on');
        if (state && state.pendingNext) {
            if (code === KEY.ENTER) { var n = state.pendingNext; clearNextUp(); playEpisode(n); return; }
            if (isBack(code)) { clearNextUp(); close(); return; }
        }
        switch (code) {
            case KEY.PLAY: engine.play(); showOsd(); return;
            case KEY.PAUSE: engine.pause(); save(true); showOsd(true); return;
            case KEY.PLAY_PAUSE: action('toggle'); return;
            case KEY.FF: action('fwd10'); return;
            case KEY.RW: action('back10'); return;
            case KEY.NEXT: case KEY.CH_UP: action('next'); return;
            case KEY.PREV: case KEY.CH_DOWN: action('prev'); return;
            case KEY.STOP: close(); return;
            case KEY.RED: action('lang'); return;
            case KEY.GREEN: action('cc'); return;
            case KEY.YELLOW: action('server'); return;
        }
        if (isBack(code)) { if (osdOn) hideOsd(); else close(); return; }
        if (!osdOn) {
            if (code === KEY.LEFT) { engine.seek(engine.time() - 10); showOsd(); return; }
            if (code === KEY.RIGHT) { engine.seek(engine.time() + 10); showOsd(); return; }
            if (code === KEY.ENTER) { action('toggle'); return; }
            showOsd();
            return;
        }
        showOsd();
        if (code === KEY.LEFT) Nav.move('left');
        else if (code === KEY.RIGHT) Nav.move('right');
        else if (code === KEY.UP) Nav.move('up');
        else if (code === KEY.DOWN) Nav.move('down');
        else if (code === KEY.ENTER) Nav.enter();
    }

    return {
        init: init,
        open: open,
        close: close,
        handleKey: handleKey,
        isActive: function () { return active; }
    };
})();
