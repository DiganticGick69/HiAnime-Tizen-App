/* Screens. Each view: render(container, params) and optional key(code) -> handled. */
var Views = {};

function langPref() {
    try { return localStorage.getItem('hianime.lang') || 'sub'; } catch (e) { return 'sub'; }
}
function setLangPref(l) { try { localStorage.setItem('hianime.lang', l); } catch (e) { /* ignore */ } }

function errorBox(container, err, retry) {
    container.innerHTML = '';
    var box = UI.h('div', 'page-pad');
    box.innerHTML = '<div class="page-title">Something went wrong</div><div class="empty">' + UI.esc(err.message || err) + '</div>';
    var b = UI.h('div', 'btn primary focusable', 'Try again');
    b.setAttribute('data-group', 'err');
    b._enter = retry;
    var s = UI.h('div', 'btn focusable', 'Settings');
    s.setAttribute('data-group', 'err');
    s._enter = function () { App.go('settings'); };
    box.appendChild(b); box.appendChild(s);
    container.appendChild(box);
    Nav.focus(b);
}

/* Resume an anime straight from a continue-watching card. */
function resumeAnime(item) {
    Api.anime(item.slug).then(function (a) {
        var r = item.resume || (a.progress && a.progress.last) || { episode: 1, lang: langPref(), position: 0 };
        var ep = r.episode, start = r.position || 0;
        if (r.watched) {
            // Finished that one: move to the next episode if there is one.
            var list = a.episodeList || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i].number === ep && list[i + 1]) { ep = list[i + 1].number; start = 0; break; }
            }
        }
        Player.open({ anime: a, episode: ep, lang: r.lang, startAt: start });
    }).catch(function (e) { UI.toast(e.message); });
}

/* ------------------------------------------------------------------ home */
Views.home = {
    render: function (c) {
        c.innerHTML = '';
        c.appendChild(UI.spinner());
        var self = this;
        Api.home().then(function (d) { self.build(c, d); })
            .catch(function (e) { errorBox(c, e, function () { App.go('home', null, true); }); });
    },

    build: function (c, d) {
        c.innerHTML = '';
        var inner = UI.h('div', 'view-inner');
        c.appendChild(inner);
        var featured = d.featured.length ? d.featured : d.trending;
        if (featured.length) inner.appendChild(this.hero(featured));

        if (d['continue'].length) {
            inner.appendChild(UI.row('Continue Watching', d['continue'], {
                wide: true, hint: 'Pick up where you left off',
                cardOpts: function (a) {
                    var r = a.resume;
                    var left = r.duration ? UI.fmtTime(r.duration - r.position) + ' left' : '';
                    return {
                        flag: 'EP ' + r.episode, meta: (r.watched ? 'Watched · next episode' : left) + ' · ' + r.lang.toUpperCase(),
                        onEnter: function () { resumeAnime(a); }
                    };
                }
            }));
        }
        if (d.recommended.length) {
            inner.appendChild(UI.row('Recommended for You', d.recommended,
                { hint: d['continue'].length ? 'Based on what you watched' : 'Top rated picks' }));
        }
        if (d.trending.length) inner.appendChild(UI.row('Trending', d.trending, {
            cardOpts: function () { return {}; }
        }));
        if (d.latestEpisodes.length) inner.appendChild(UI.row('Latest Episodes', d.latestEpisodes, {
            cardOpts: function (a) { return a.latestEpisode ? { flag: 'EP ' + a.latestEpisode } : {}; }
        }));
        if (d.popular.length) inner.appendChild(UI.row('Most Popular', d.popular));
        if (d.newest.length) inner.appendChild(UI.row('New on HiAnime', d.newest));

        // Category rows load after the first paint so the screen appears quickly.
        var cats = d.categories.slice(0, 8);
        cats.forEach(function (cat) {
            var slot = UI.h('div');
            inner.appendChild(slot);
            Api.category(cat.id, 1).then(function (res) {
                if (!res.results.length) return;
                var r = UI.row(cat.name, res.results.slice(0, 20), { hint: 'More in Categories' });
                slot.appendChild(r);
            }).catch(function () { /* row just stays empty */ });
        });

        if (App.restoreFocus()) return;
        var first = inner.querySelector('.hero .focusable') || inner.querySelector('.focusable');
        if (first) Nav.focus(first);
    },

    hero: function (list) {
        list = list.slice(0, 8);
        var hero = UI.h('section', 'hero row');
        var bg = UI.h('div', 'hero-bg');
        var content = UI.h('div', 'hero-content');
        var dots = UI.h('div', 'hero-dots');
        hero.appendChild(bg); hero.appendChild(content); hero.appendChild(dots);
        var idx = 0, timer = null;

        function show(i) {
            idx = (i + list.length) % list.length;
            var a = list[idx];
            bg.style.backgroundImage = 'url("' + Api.abs(a.banner || a.image) + '")';
            var meta = '';
            if (a.type) meta += '<span class="badge type">' + UI.esc(a.type) + '</span>';
            meta += UI.badges(a);
            if (a.episodes) meta += '<span class="badge eps">' + a.episodes + ' EPS</span>';
            if (a.aired) meta += '<span>' + UI.esc(a.aired) + '</span>';
            content.innerHTML =
                '<div class="hero-spot">#' + (idx + 1) + ' Spotlight</div>' +
                '<div class="hero-title">' + UI.esc(a.title) + '</div>' +
                '<div class="hero-meta">' + meta + '</div>' +
                '<div class="hero-syn">' + UI.esc(a.synopsis) + '</div>';
            var watch = UI.h('div', 'btn primary focusable', '<span class="ico">' + icon('play') + '</span>Watch Now');
            var info = UI.h('div', 'btn focusable', '<span class="ico">' + icon('info') + '</span>Details');
            [watch, info].forEach(function (b) {
                b.setAttribute('data-group', 'hero');
                b.setAttribute('data-scroll-top', '1');
                b._focus = function () { clearInterval(timer); };
                b._blur = rotate;
                content.appendChild(b);
            });
            watch._enter = function () {
                Api.anime(a.slug).then(function (full) {
                    var last = full.progress && full.progress.last;
                    var first = full.episodeList[0];
                    if (!first) { App.go('detail', { slug: a.slug }); return; }
                    Player.open({ anime: full, episode: last ? last.episode : first.number,
                                  lang: last ? last.lang : langPref(), startAt: last ? last.position : 0 });
                }).catch(function (e) { UI.toast(e.message); });
            };
            info._enter = function () { App.go('detail', { slug: a.slug }); };
            // Left/right on the hero buttons pages through the spotlight.
            watch._left = function () { show(idx - 1); Nav.focus(content.querySelector('.btn.primary')); return true; };
            info._right = function () { show(idx + 1); Nav.focus(content.querySelector('.btn:not(.primary)')); return true; };
            var html = '';
            for (var k = 0; k < list.length; k++) html += '<i class="' + (k === idx ? 'on' : '') + '"></i>';
            dots.innerHTML = html;
        }

        function rotate() {
            clearInterval(timer);
            timer = setInterval(function () {
                if (!document.body.contains(hero)) { clearInterval(timer); return; }
                var cur = Nav.current();
                if (cur && hero.contains(cur)) return;
                show(idx + 1);
            }, 9000);
        }

        show(0);
        rotate();
        return hero;
    },

    key: function (code) {
        var cur = Nav.current();
        if (!cur) return false;
        if (code === KEY.LEFT && cur._left) return cur._left();
        if (code === KEY.RIGHT && cur._right) return cur._right();
        return false;
    }
};

/* ---------------------------------------------------------------- detail */
Views.detail = {
    render: function (c, params) {
        c.innerHTML = '';
        c.appendChild(UI.spinner());
        var self = this;
        Api.anime(params.slug).then(function (a) { self.build(c, a, params); })
            .catch(function (e) { errorBox(c, e, function () { App.go('detail', params, true); }); });
    },

    build: function (c, a, params) {
        this.anime = a;
        var prog = a.progress || { episodes: {}, last: null };
        var lang = (prog.last && prog.last.lang) || langPref();
        if (lang === 'dub' && !a.dub) lang = 'sub';
        this.lang = lang;

        c.innerHTML = '';
        var inner = UI.h('div', 'view-inner detail');
        var bg = UI.h('div', 'detail-bg');
        bg.style.backgroundImage = 'url("' + Api.abs(a.banner || a.image) + '")';
        inner.appendChild(bg);

        var top = UI.h('div', 'detail-top row');
        var poster = UI.h('div', 'detail-poster');
        poster.style.backgroundImage = 'url("' + Api.abs(a.image) + '")';
        top.appendChild(poster);
        var info = UI.h('div', 'detail-info');
        var meta = '';
        if (a.type) meta += '<span class="badge type">' + UI.esc(a.type) + '</span>';
        meta += UI.badges(a);
        if (a.episodes) meta += '<span class="badge eps">' + a.episodes + ' EPS</span>';
        if (a.duration) meta += '<span>' + UI.esc(a.duration) + '</span>';
        var facts = '';
        if (a.score) facts += '<span>Score<b>' + UI.esc(a.score) + '</b></span>';
        if (a.status) facts += '<span>Status<b>' + UI.esc(a.status) + '</b></span>';
        if (a.aired) facts += '<span>Aired<b>' + UI.esc(a.aired) + '</b></span>';
        var watchedCount = 0;
        for (var k in prog.episodes) if (prog.episodes[k].watched) watchedCount++;
        if (watchedCount) facts += '<span>Watched<b>' + watchedCount + ' / ' + a.episodeList.length + '</b></span>';
        var genres = a.genres.map(function (g) { return '<span class="genre-tag">' + UI.esc(g) + '</span>'; }).join('');
        info.innerHTML =
            '<div class="detail-crumb">Home • ' + UI.esc(a.type || 'Anime') + ' • ' + UI.esc(a.title) + '</div>' +
            '<div class="detail-title">' + UI.esc(a.title) + '</div>' +
            (a.japanese && a.japanese !== a.title ? '<div class="detail-jp">' + UI.esc(a.japanese) + '</div>' : '') +
            '<div class="hero-meta">' + meta + '</div>' +
            '<div class="detail-syn">' + UI.esc(a.synopsis || 'No description available.') + '</div>';
        var actions = UI.h('div', 'detail-actions');
        info.appendChild(actions);
        var f = UI.h('div', 'facts', facts);
        info.appendChild(f);
        info.appendChild(UI.h('div', 'detail-genres', genres));
        top.appendChild(info);
        inner.appendChild(top);

        this.buildActions(actions, a, prog);
        inner.appendChild(this.buildEpisodes(a, prog, params));
        c.appendChild(inner);

        if (App.restoreFocus()) return;
        Nav.focus(actions.querySelector('.btn.primary'));
    },

    resumeTarget: function (a, prog) {
        var last = prog.last;
        var list = a.episodeList;
        if (!list.length) return null;
        if (!last) return { ep: list[0], start: 0, label: 'Play Episode ' + list[0].number };
        var e = prog.episodes[String(last.episode)];
        if (e && e.watched) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].number === last.episode && list[i + 1]) {
                    return { ep: list[i + 1], start: 0, label: 'Watch Episode ' + list[i + 1].number };
                }
            }
        }
        for (var j = 0; j < list.length; j++) {
            if (list[j].number === last.episode) {
                return { ep: list[j], start: last.position, label: 'Resume Episode ' + last.episode + ' · ' + UI.fmtTime(last.position) };
            }
        }
        return { ep: list[0], start: 0, label: 'Play Episode ' + list[0].number };
    },

    buildActions: function (box, a, prog) {
        var self = this;
        var target = this.resumeTarget(a, prog);
        if (target) {
            var play = UI.h('div', 'btn primary focusable', '<span class="ico">' + icon('play') + '</span>' + UI.esc(target.label));
            play.setAttribute('data-group', 'actions');
            play.setAttribute('data-scroll-top', '1');
            play._enter = function () { self.play(target.ep, target.start); };
            box.appendChild(play);
        }
        var toggle = UI.h('div', 'lang-toggle');
        ['sub', 'dub'].forEach(function (l) {
            var avail = l === 'sub' ? (a.sub !== 0) : !!a.dub;
            var seg = UI.h('div', 'seg focusable' + (self.lang === l ? ' on' : '') + (avail ? '' : ' disabled'),
                l === 'sub' ? 'SUB' : 'DUB');
            seg.setAttribute('data-group', 'actions');
            seg.setAttribute('data-scroll-top', '1');
            seg._enter = function () {
                if (!avail) { UI.toast('No dub available for this anime'); return; }
                self.lang = l;
                setLangPref(l);
                var segs = toggle.querySelectorAll('.seg');
                for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', segs[i] === seg);
                self.refreshEpisodes();
            };
            toggle.appendChild(seg);
        });
        box.appendChild(toggle);
        var more = UI.h('div', 'btn focusable', 'More info');
        more.setAttribute('data-group', 'actions');
        more.setAttribute('data-scroll-top', '1');
        more._enter = function () {
            var syn = document.querySelector('.detail-syn');
            syn.classList.toggle('expanded');
            more.textContent = syn.classList.contains('expanded') ? 'Less info' : 'More info';
        };
        box.appendChild(more);
        if (prog.last) {
            var rm = UI.h('div', 'btn focusable', '<span class="ico">' + icon('trash') + '</span>Remove from Watched');
            rm.setAttribute('data-group', 'actions');
            rm.setAttribute('data-scroll-top', '1');
            rm._enter = function () {
                Api.forget(a.slug).then(function () { UI.toast('Removed from Watched'); App.go('detail', { slug: a.slug }, true); });
            };
            box.appendChild(rm);
        }
    },

    buildEpisodes: function (a, prog, params) {
        var self = this;
        var wrap = UI.h('div', 'episodes');
        var list = a.episodeList;
        var head = UI.h('div', 'ep-head', '<h3>Episodes</h3>');
        var ranges = UI.h('div', 'ep-ranges');
        head.appendChild(ranges);
        wrap.appendChild(head);
        wrap.appendChild(UI.h('div', 'ep-legend',
            '<span class="l-w">Watched</span><span class="l-p">In progress</span><span class="l-n">Not watched</span>' +
            '<span style="margin-left:auto">RED button: mark watched / unwatched</span>'));
        var grid = UI.h('div', 'ep-grid');
        wrap.appendChild(grid);
        this.epGrid = grid;
        this.prog = prog;

        var PAGE = 100;
        var current = prog.last ? prog.last.episode : (list[0] ? list[0].number : 1);
        var startPage = 0;
        for (var i = 0; i < list.length; i++) if (list[i].number === current) startPage = Math.floor(i / PAGE);
        if (params && params.page != null) startPage = params.page;
        this.page = startPage;

        if (list.length > PAGE) {
            for (var p = 0; p * PAGE < list.length; p++) {
                (function (p) {
                    var from = list[p * PAGE].number, to = list[Math.min(list.length, (p + 1) * PAGE) - 1].number;
                    var r = UI.h('div', 'ep-range focusable' + (p === startPage ? ' active' : ''), from + '-' + to);
                    r.setAttribute('data-group', 'ranges');
                    r._enter = function () {
                        self.page = p;
                        var all = ranges.querySelectorAll('.ep-range');
                        for (var j = 0; j < all.length; j++) all[j].classList.toggle('active', all[j] === r);
                        self.refreshEpisodes();
                    };
                    ranges.appendChild(r);
                })(p);
            }
        }
        if (!list.length) grid.appendChild(UI.h('div', 'empty', 'No episodes available yet.'));
        this.refreshEpisodes();
        return wrap;
    },

    refreshEpisodes: function () {
        var self = this, a = this.anime, prog = this.prog, grid = this.epGrid;
        var PAGE = 100;
        var list = a.episodeList.slice(this.page * PAGE, (this.page + 1) * PAGE);
        var focusedNum = Nav.current() && Nav.current()._ep ? Nav.current()._ep.number : null;
        grid.innerHTML = '';
        var lastEp = prog.last ? prog.last.episode : null;
        list.forEach(function (ep) {
            var p = prog.episodes[String(ep.number)];
            var avail = self.lang === 'dub' ? ep.hasDub : ep.hasSub;
            var cls = 'ep focusable';
            if (p && p.watched) cls += ' watched';
            if (!avail) cls += ' unavailable';
            if (ep.number === lastEp) cls += ' current';
            var el = UI.h('div', cls, String(ep.number));
            el.setAttribute('data-group', 'episodes');
            if (p && !p.watched && p.duration) {
                var bar = UI.h('div', 'ep-bar');
                bar.style.width = Math.min(100, 100 * p.position / p.duration) + '%';
                el.appendChild(bar);
            }
            el._ep = ep;
            el._enter = function () {
                if (!avail) { UI.toast((self.lang === 'dub' ? 'Dub' : 'Sub') + ' not available for episode ' + ep.number); return; }
                var start = p && !p.watched ? p.position : 0;
                self.play(ep, start);
            };
            grid.appendChild(el);
            if (ep.number === focusedNum) Nav.focus(el);
        });
    },

    play: function (ep, start) {
        App.rememberFocus();
        Player.open({ anime: this.anime, episode: ep.number, lang: this.lang, startAt: start || 0 });
    },

    key: function (code) {
        var cur = Nav.current();
        if (code === KEY.RED && cur && cur._ep) {
            var self = this, ep = cur._ep;
            var p = this.prog.episodes[String(ep.number)];
            var watched = !(p && p.watched);
            Api.markWatched(this.anime.slug, ep.number, watched).then(function () {
                if (watched) self.prog.episodes[String(ep.number)] = { watched: true, position: 0, duration: 0, lang: self.lang };
                else delete self.prog.episodes[String(ep.number)];
                self.refreshEpisodes();
                UI.toast('Episode ' + ep.number + (watched ? ' marked as watched' : ' marked as not watched'));
            }).catch(function (e) { UI.toast(e.message); });
            return true;
        }
        return false;
    }
};

/* ---------------------------------------------------------------- search */
Views.search = {
    render: function (c) {
        var self = this;
        c.innerHTML = '';
        var wrap = UI.h('div', 'view-inner');
        var s = UI.h('div', 'search-wrap');
        var left = UI.h('div', 'search-left');
        var box = UI.h('div', 'search-box', '<span class="ico">' + icon('search') + '</span><span class="q"></span><span class="caret"></span>');
        left.appendChild(box);
        var kbEl = UI.h('div', 'kb');
        left.appendChild(kbEl);
        var right = UI.h('div', 'search-right');
        right.innerHTML = '<div class="page-title">Search</div><div class="empty">Type a title with the keyboard on the left.</div>';
        s.appendChild(left); s.appendChild(right);
        wrap.appendChild(s);
        c.appendChild(wrap);
        var timer = null, seq = 0;
        var q = box.querySelector('.q');
        this.kb = Keyboard.create(kbEl, function (text) {
            q.textContent = text;
            clearTimeout(timer);
            if (text.trim().length < 2) return;
            timer = setTimeout(function () { self.run(right, text.trim(), ++seq, function () { return seq; }); }, 600);
        });
        if (this.lastQuery) this.kb.set(this.lastQuery);
        if (!App.restoreFocus()) Nav.focus(kbEl.querySelector('.key'));
    },

    run: function (right, text, mySeq, getSeq) {
        this.lastQuery = text;
        right.innerHTML = '<div class="page-title">Results for <span class="accent">' + UI.esc(text) + '</span></div>';
        right.appendChild(UI.spinner());
        Api.search(text).then(function (d) {
            if (mySeq !== getSeq()) return;
            right.removeChild(right.lastChild);
            if (!d.results.length) { right.appendChild(UI.h('div', 'empty', 'Nothing found.')); return; }
            right.appendChild(UI.grid(d.results.slice(0, 40), 'results'));
        }).catch(function (e) {
            if (mySeq === getSeq()) right.innerHTML = '<div class="empty">' + UI.esc(e.message) + '</div>';
        });
    },

    key: function (code, ev) {
        // Physical keyboards (desktop preview, USB keyboards on the TV).
        if (ev && ev.key && ev.key.length === 1 && /[a-z0-9 ]/i.test(ev.key)) { this.kb.type(ev.key.toLowerCase()); return true; }
        if (code === KEY.BACKSPACE && this.kb.value()) { this.kb.backspace(); return true; }
        return false;
    }
};

/* ------------------------------------------------------------ categories */
Views.categories = {
    render: function (c, params) {
        var self = this;
        c.innerHTML = '';
        var inner = UI.h('div', 'view-inner');
        var pad = UI.h('div', 'page-pad');
        pad.innerHTML = '<div class="page-title">Categories</div>';
        var chips = UI.h('div', 'chips row');
        var results = UI.h('div', 'cat-results');
        pad.appendChild(chips); pad.appendChild(results);
        inner.appendChild(pad);
        c.appendChild(inner);
        this.results = results;
        Api.categories().then(function (cats) {
            var selected = (params && params.id) || self.lastId || cats[0].id;
            cats.forEach(function (cat) {
                var chip = UI.h('div', 'chip focusable' + (cat.id === selected ? ' active' : ''), UI.esc(cat.name));
                chip.setAttribute('data-group', 'chips');
                chip.setAttribute('data-scroll-top', '1');
                chip._enter = function () {
                    var all = chips.querySelectorAll('.chip');
                    for (var i = 0; i < all.length; i++) all[i].classList.toggle('active', all[i] === chip);
                    self.load(cat.id);
                };
                chips.appendChild(chip);
            });
            self.load(selected);
            if (!App.restoreFocus()) Nav.focus(chips.querySelector('.chip.active') || chips.firstChild);
        }).catch(function (e) { errorBox(c, e, function () { App.go('categories', params, true); }); });
    },

    load: function (id) {
        var self = this;
        this.lastId = id; this.page = 1; this.totalPages = 1; this.loading = true;
        this.results.innerHTML = '';
        this.results.appendChild(UI.spinner());
        var token = this.token = {};
        Api.category(id, 1).then(function (d) {
            if (token !== self.token) return;
            self.results.innerHTML = '';
            self.totalPages = d.totalPages;
            self.grid = UI.grid(d.results, 'cat-grid', self.cardOpts());
            self.results.appendChild(self.grid);
            if (!d.results.length) self.results.appendChild(UI.h('div', 'empty', 'Nothing here yet.'));
            self.loading = false;
        }).catch(function (e) { self.results.innerHTML = '<div class="empty">' + UI.esc(e.message) + '</div>'; });
    },

    cardOpts: function () {
        var self = this;
        return function () { return { onFocus: function () { self.maybeMore(); } }; };
    },

    maybeMore: function () {
        // Infinite scroll: fetch the next page when focus reaches the last rows.
        if (this.loading || this.page >= this.totalPages || !this.grid) return;
        var cards = this.grid.children, cur = Nav.current();
        var idx = Array.prototype.indexOf.call(cards, cur);
        if (idx < cards.length - 14) return;
        var self = this, token = this.token;
        this.loading = true;
        Api.category(this.lastId, this.page + 1).then(function (d) {
            if (token !== self.token) return;
            self.page += 1;
            var have = {};
            for (var i = 0; i < cards.length; i++) have[cards[i]._anime.slug] = 1;
            UI.appendGrid(self.grid, d.results.filter(function (a) { return !have[a.slug]; }), 'cat-grid', self.cardOpts());
            self.loading = false;
        }).catch(function () { self.loading = false; });
    }
};

/* --------------------------------------------------------------- watched */
Views.watched = {
    render: function (c) {
        c.innerHTML = '';
        var inner = UI.h('div', 'view-inner');
        var pad = UI.h('div', 'page-pad');
        pad.innerHTML = '<div class="page-title">Watched</div>';
        inner.appendChild(pad);
        c.appendChild(inner);
        pad.appendChild(UI.spinner());
        Api.watched().then(function (d) {
            pad.removeChild(pad.lastChild);
            if (!d.results.length) {
                pad.appendChild(UI.h('div', 'empty', 'Nothing yet. Episodes you watch show up here so you can keep going.'));
                Nav.focus(document.querySelector('#sidebar [data-route="watched"]'));
                return;
            }
            pad.appendChild(UI.h('div', 'row-hint', 'OK: open · PLAY: resume · RED: remove from list'));
            pad.lastChild.style.marginBottom = '30px';
            pad.appendChild(UI.grid(d.results, 'watched', function (a) {
                var r = a.resume, total = a.episodes || '?';
                return {
                    flag: 'EP ' + r.episode,
                    meta: a.watchedCount + ' / ' + total + ' watched · ' + r.lang.toUpperCase()
                };
            }));
            if (!App.restoreFocus()) Nav.focusFirst('.grid .card');
        }).catch(function (e) { errorBox(c, e, function () { App.go('watched', null, true); }); });
    },

    key: function (code) {
        var cur = Nav.current();
        if (!cur || !cur._anime) return false;
        if (code === KEY.PLAY || code === KEY.PLAY_PAUSE) { App.rememberFocus(); resumeAnime(cur._anime); return true; }
        if (code === KEY.RED) {
            var a = cur._anime;
            Api.forget(a.slug).then(function () {
                UI.toast('Removed ' + a.title);
                var next = cur.nextSibling || cur.previousSibling;
                cur.parentNode.removeChild(cur);
                if (next) Nav.focus(next); else App.go('watched', null, true);
            });
            return true;
        }
        return false;
    }
};

/* -------------------------------------------------------------- settings */
Views.settings = {
    render: function (c) {
        c.innerHTML = '';
        var inner = UI.h('div', 'view-inner');
        var pad = UI.h('div', 'page-pad');
        pad.innerHTML =
            '<div class="page-title">Settings</div>' +
            '<div class="status-box">Checking the site…</div>' +
            '<div class="form-row"><label>Site mirrors (comma separated, tried first)</label>' +
            '<input id="set-domains" class="focusable" data-group="form" type="text" placeholder="hianimes.se, hianime.at">' +
            '<div class="form-help">When the site moves to a new domain, add it here. The app finds the catalog API automatically.</div></div>';
        var save = UI.h('div', 'btn primary focusable', 'Save & test');
        var clear = UI.h('div', 'btn focusable', 'Clear watch history');
        save.setAttribute('data-group', 'form-btn'); clear.setAttribute('data-group', 'form-btn');
        pad.appendChild(save); pad.appendChild(clear);
        inner.appendChild(pad);
        c.appendChild(inner);

        var domains = pad.querySelector('#set-domains');
        domains.value = Api.userDomains().join(', ');
        domains._enter = function () { domains.focus(); };
        var status = pad.querySelector('.status-box');

        function show(s) {
            status.innerHTML = 'Site: <b>reachable</b><br>' +
                'Active mirror: <b>' + UI.esc(s.site || 'none (using a known API)') + '</b> · Catalog API: <b>' + UI.esc(s.api || 'none') + '</b><br>' +
                'Everything runs on this TV. Watch history is stored only here.';
        }
        function fail(e) { status.innerHTML = 'Site: <b>not reachable</b> — ' + UI.esc(e.message); }

        save._enter = function () {
            status.textContent = 'Testing mirrors…';
            var list = domains.value.split(',').map(function (d) { return d.trim(); }).filter(Boolean);
            Api.setDomains(list).then(function (s) { UI.toast('Saved'); show(s); }).catch(fail);
        };
        var armed = 0;
        clear._enter = function () {
            if (Date.now() - armed > 4000) { armed = Date.now(); UI.toast('Press again to clear all watch history'); return; }
            armed = 0;
            Api.clearHistory().then(function () { UI.toast('Watch history cleared'); });
        };
        Api.status().then(show).catch(fail);
        Nav.focus(save);
    }
};
