/*
 * Everything the app needs, done on the TV itself: catalog, mirrors, streams,
 * subtitles and watch history. No backend.
 *
 * - Catalog: the site's JSON API, found through its mirror domains.
 * - Streams: the zokoanime embed page carries the HLS link, XOR + base64 encoded
 *   in window.__P. Only that page's HTML is fetched; its scripts and ads never run.
 * - The video host only answers requests with the player's Referer. AVPlay sends
 *   it (see Player); subtitles are downloaded with it through tizen.download.
 * - History lives in localStorage and never leaves the TV.
 */
var Api = (function () {
    var DEFAULT_SITE_DOMAINS = ['hianimes.se', 'hianime.at', 'hianimes.to', 'hianime.to', 'hianime.sx',
        'hianime.nz', 'hianime.bz', 'hianime.pe', 'hianime.cx'];
    var DEFAULT_API_BASES = ['https://animehot.cc/api', 'https://anitv.cfd/api'];
    var ZOKO_HOST = 'zokoanime.video';
    var ZOKO_KEY = 'otaku-embed-v1';
    var ZOKO_REFERER = 'https://' + ZOKO_HOST + '/';
    var WATCHED_RATIO = 0.9;
    var HIDDEN_GENRES = { Hentai: true };

    var K_DOMAINS = 'hianime.domains', K_MIRROR = 'hianime.mirror', K_HISTORY = 'hianime.history';

    var CATEGORIES = [
        { id: 'isekai', name: 'Isekai', keywords: ['isekai', 'another world', 'reincarnated', 'reincarnation', 'summoned'] },
        { id: 'action', name: 'Action', genre: ['Action'] },
        { id: 'fantasy', name: 'Fantasy', genre: ['Fantasy'] },
        { id: 'romance', name: 'Romance', genre: ['Romance'] },
        { id: 'comedy', name: 'Comedy', genre: ['Comedy'] },
        { id: 'scifi', name: 'Sci-Fi', genre: ['Sci-Fi'] },
        { id: 'sliceoflife', name: 'Slice of Life', genre: ['Slice of Life'] },
        { id: 'sports', name: 'Sports', genre: ['Sports'] },
        { id: 'mecha', name: 'Mecha', genre: ['Mecha'] },
        { id: 'supernatural', name: 'Supernatural', genre: ['Supernatural'] },
        { id: 'mystery', name: 'Mystery', genre: ['Mystery'] },
        { id: 'psychological', name: 'Psychological', genre: ['Psychological'] },
        { id: 'horror', name: 'Horror', genre: ['Horror'] },
        { id: 'drama', name: 'Drama', genre: ['Drama'] }
    ];

    /* ------------------------------------------------------------ storage */
    function load(key, fallback) {
        try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
    }
    function store(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* full or unavailable */ }
    }

    /* --------------------------------------------------------------- http */
    function http(method, url, body, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.timeout = timeoutMs || 15000;
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () { resolve({ status: xhr.status, text: xhr.responseText }); };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.ontimeout = function () { reject(new Error('Timed out')); };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    function TTLCache(ttlMs) { this.ttl = ttlMs; this.data = {}; this.size = 0; }
    TTLCache.prototype.get = function (k) {
        var hit = this.data[k];
        return hit && Date.now() - hit.t < this.ttl ? hit.v : undefined;
    };
    TTLCache.prototype.put = function (k, v) {
        if (++this.size > 500) { this.data = {}; this.size = 0; }
        this.data[k] = { t: Date.now(), v: v };
    };

    /* ------------------------------------------------------------ mirrors */
    var CHUNK_RE = /\/_next\/static\/chunks\/[A-Za-z0-9_.~-]+\.js/g;
    var API_RE = /https:\/\/[A-Za-z0-9.-]+\.[a-z]{2,}\/api(?=["`,])/g;
    var mirror = load(K_MIRROR, { site: null, api: null, checkedAt: 0 });
    var resolving = null;

    function cleanDomain(d) {
        return String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    }

    function candidates() {
        var seen = {}, out = [];
        load(K_DOMAINS, []).concat(DEFAULT_SITE_DOMAINS).forEach(function (d) {
            d = cleanDomain(d);
            if (d && !seen[d]) { seen[d] = true; out.push(d); }
        });
        return out;
    }

    function apiWorks(base) {
        return http('GET', base + '/anime/trending', null, 8000).then(function (r) {
            try { return r.status === 200 && !!JSON.parse(r.text).animes; } catch (e) { return false; }
        }, function () { return false; });
    }

    function unique(list) {
        var seen = {}, out = [];
        (list || []).forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
        return out;
    }

    /* The site's JS bundle names its API; read it so a mirror change needs one domain. */
    function apisFromSite(domain) {
        return http('GET', 'https://' + domain + '/home', null, 10000).then(function (r) {
            if (r.status !== 200 || r.text.indexOf('/_next/') < 0) return [];
            var chunks = unique(r.text.match(CHUNK_RE));
            var i = 0;
            function next() {
                if (i >= chunks.length) return [];
                return http('GET', 'https://' + domain + chunks[i++], null, 10000).then(function (c) {
                    var apis = unique(c.text.match(API_RE));
                    return apis.length ? apis : next();
                }, next);
            }
            return next();
        }, function () { return []; });
    }

    function firstWorking(list) {
        var i = 0;
        function next() {
            if (i >= list.length) return Promise.resolve(null);
            var base = list[i++];
            return apiWorks(base).then(function (ok) { return ok ? base : next(); });
        }
        return next();
    }

    function remember(site, api) {
        mirror = { site: site, api: api, checkedAt: Date.now() };
        store(K_MIRROR, mirror);
        return api;
    }

    function probeMirrors() {
        var domains = candidates(), i = 0;
        function next() {
            if (i >= domains.length) {
                return firstWorking(DEFAULT_API_BASES).then(function (api) {
                    if (api) return remember(null, api);
                    throw new Error('No working mirror found. Add the current domain in Settings.');
                });
            }
            var d = domains[i++];
            return apisFromSite(d).then(firstWorking).then(function (api) { return api ? remember(d, api) : next(); });
        }
        return next();
    }

    function resolve(force) {
        if (mirror.api && !force && Date.now() - mirror.checkedAt < 3600000) return Promise.resolve(mirror.api);
        if (resolving) return resolving;
        // A remembered API that still answers is reused; mirrors are probed only when it stops.
        var start = mirror.api && !force ? apiWorks(mirror.api) : Promise.resolve(false);
        resolving = start.then(function (ok) { return ok ? remember(mirror.site, mirror.api) : probeMirrors(); });
        resolving.then(function () { resolving = null; }, function () { resolving = null; });
        return resolving;
    }

    /* --------------------------------------------------------- site API */
    function request(method, path, body, attempt) {
        attempt = attempt || 0;
        return resolve(attempt > 0).then(function (api) {
            return http(method, api + path, body, 15000);
        }).then(function (r) {
            if (r.status === 404) return null;
            if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
            return JSON.parse(r.text);
        }).catch(function (e) {
            if (attempt === 0) return request(method, path, body, 1);
            throw new Error('Catalog unavailable (' + e.message + ')');
        });
    }

    var cache = new TTLCache(300000);
    function cached(key, method, path, body) {
        var hit = cache.get(key);
        if (hit !== undefined) return Promise.resolve(hit);
        return request(method, path, body).then(function (d) {
            if (d !== null) cache.put(key, d);
            return d;
        });
    }

    /* ------------------------------------------------- record whitelist */
    var SCORE_RE = /^\d{1,2}(\.\d+)?$/;
    var textBox = document.createElement('textarea');

    function int(v) { var n = parseInt(String(v).trim(), 10); return isNaN(n) ? null : n; }
    function text(s) {
        if (typeof s !== 'string') return '';
        textBox.innerHTML = s.replace(/<[^>]+>/g, '');
        return textBox.value.trim();
    }
    function score(a) {
        var keys = ['Score', 'score'];
        for (var i = 0; i < keys.length; i++) {
            var v = String(a[keys[i]] || '').trim();
            if (SCORE_RE.test(v) && parseFloat(v) > 0) return v;
        }
        return null;
    }
    function img(u) { return typeof u === 'string' && /^https?:\/\//.test(u) ? u : null; }

    function slim(a) {
        if (!a || typeof a !== 'object') return null;
        var slug = a.slug || (a.slugs || [])[0];
        if (!slug) return null;
        var genres = (a.genres || []).filter(function (g) { return typeof g === 'string'; });
        for (var i = 0; i < genres.length; i++) if (HIDDEN_GENRES[genres[i]]) return null;
        var total = int(a.totalEpisodes);
        return {
            slug: slug,
            title: text(a.title || a.English || a.alternateTitle) || 'Untitled',
            japanese: a.Japanese || null,
            image: img(a.image || a.originalImage),
            banner: img(a.landScapeImage || a.originalLandScapeImage || a.image),
            synopsis: text(a.synopsis),
            genres: genres,
            type: a.Type || null,
            status: a.Status || null,
            aired: a.Aired || null,
            duration: a.Duration && a.Duration !== 'Unknown' ? a.Duration : null,
            score: score(a),
            episodes: total || (Array.isArray(a.episodes) ? a.episodes.length : null),
            sub: int(a.totalSubbed),
            dub: int(a.totalDubbed)
        };
    }

    function slimList(items) {
        var out = [], seen = {};
        (items || []).forEach(function (a) {
            var s = slim(a);
            if (s && !seen[s.slug]) { seen[s.slug] = true; out.push(s); }
        });
        return out;
    }

    /* ------------------------------------------------------------ catalog */
    function catalogHome() {
        return cached('home', 'GET', '/home').then(function (d) {
            d = d || {};
            function sec(k) { return (d[k] || {}).animes; }
            var latest = [];
            ((d.latestEpisodes || {}).episodes || []).forEach(function (e) {
                var a = slim(e.anime_info);
                if (a) { a.latestEpisode = e.episodeNumber; latest.push(a); }
            });
            return {
                featured: slimList((d.featured || []).map(function (f) { return f.anime; })),
                trending: slimList(sec('trending')),
                popular: slimList(sec('popular')),
                airing: slimList(sec('currentlyAiring')),
                latestEpisodes: latest,
                newest: slimList(sec('latestAnime'))
            };
        });
    }

    function filter(o) {
        var body = { page: o.page || 1, limit: o.limit || 24 };
        if (o.genre) body.genre = o.genre;
        if (o.keyword) body.keyword = o.keyword;
        var sort = o.sort || 'Popularity';
        if (sort !== 'Default') body.sort = sort;
        return cached('filter:' + JSON.stringify(body), 'POST', '/filter', body).then(function (d) {
            d = d || {};
            return { results: slimList(d.results), page: d.page || body.page, totalPages: d.totalPages || 1 };
        });
    }

    function category(id, page) {
        var cat = null;
        for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].id === id) cat = CATEGORIES[i];
        if (!cat) return Promise.resolve({ results: [], page: 1, totalPages: 1 });
        var p;
        if (cat.genre) p = filter({ genre: cat.genre, page: page });
        else {
            p = Promise.all(cat.keywords.map(function (k) {
                return filter({ keyword: k, page: page, limit: 24 }).catch(function () { return null; });
            })).then(function (parts) {
                var merged = [], seen = {}, pages = 1;
                parts.forEach(function (part) {
                    if (!part) return;
                    pages = Math.max(pages, part.totalPages);
                    part.results.forEach(function (a) { if (!seen[a.slug]) { seen[a.slug] = true; merged.push(a); } });
                });
                return { results: merged, page: page, totalPages: pages };
            });
        }
        return p.then(function (res) { res.name = cat.name; res.id = id; return res; });
    }

    function search(q) {
        q = String(q || '').trim().slice(0, 80);
        if (q.length < 2) return Promise.resolve({ results: [] });
        return cached('search:' + q.toLowerCase(), 'POST', '/search', { title: q }).then(function (d) {
            var results = slimList(Array.isArray(d) ? d : []);
            if (results.length >= 6) return { results: results };
            return filter({ keyword: q, limit: 24 }).then(function (extra) {
                var seen = {};
                results.forEach(function (a) { seen[a.slug] = true; });
                return { results: results.concat(extra.results.filter(function (a) { return !seen[a.slug]; })) };
            }, function () { return { results: results }; });
        });
    }

    var detailCache = new TTLCache(1800000);
    function rawDetail(slug) {
        var hit = detailCache.get(slug);
        if (hit !== undefined) return Promise.resolve(hit);
        return request('GET', '/anime/' + encodeURIComponent(slug)).then(function (d) {
            var a = d && d.anime;
            if (!a) return null;
            // The record embeds only the first episode; the full list comes separately.
            if (!a._id) return a;
            return request('GET', '/episodes/' + encodeURIComponent(a._id) + '?start=1&end=100000').then(function (eps) {
                if (eps && Array.isArray(eps.episodes) && eps.episodes.length) a.episodes = eps.episodes;
                return a;
            }, function () { return a; });
        }).then(function (a) { if (a) detailCache.put(slug, a); return a; });
    }

    function episodeTitle(t, n) {
        if (typeof t === 'string' && t.indexOf('Episode') >= 0) return 'Episode' + t.split('Episode').pop();
        return 'Episode ' + n;
    }

    function detail(slug) {
        return rawDetail(slug).then(function (raw) {
            var a = slim(raw);
            if (!a) throw new Error('Anime not found');
            // Records carry several slugs; keep the one asked for so history uses one key.
            a.slug = slug;
            var dubCount = a.dub || 0, subCount = a.sub;
            a.episodeList = (raw.episodes || []).filter(function (e) { return e && typeof e === 'object'; }).map(function (e) {
                var n = e.episodeNumber, link = e.link || {};
                return {
                    number: n,
                    title: episodeTitle(e.title, n),
                    hasSub: !!(link.sub && link.sub.length) && (subCount === null || n <= subCount),
                    hasDub: !!(link.dub && link.dub.length) && n <= dubCount
                };
            }).sort(function (x, y) { return (x.number || 0) - (y.number || 0); });
            a.progress = History.animeProgress(slug);
            return a;
        });
    }

    function embedLinks(slug, number, lang) {
        return rawDetail(slug).then(function (raw) {
            var eps = (raw && raw.episodes) || [];
            for (var i = 0; i < eps.length; i++) {
                if (eps[i] && eps[i].episodeNumber === number) {
                    return (((eps[i].link || {})[lang]) || []).filter(function (l) { return typeof l === 'string'; });
                }
            }
            return [];
        });
    }

    /* ------------------------------------------------------------ history */
    var History = (function () {
        var h = load(K_HISTORY, null) || { anime: {}, progress: {} };
        function save() { store(K_HISTORY, h); }

        function rememberAnime(a) {
            var meta = {};
            ['slug', 'title', 'image', 'banner', 'genres', 'type', 'episodes', 'sub', 'dub'].forEach(function (k) { meta[k] = a[k]; });
            h.anime[a.slug] = meta;
        }

        return {
            rememberAnime: function (a) { rememberAnime(a); save(); },
            saveProgress: function (slug, ep, lang, pos, dur) {
                var eps = h.progress[slug] || (h.progress[slug] = {});
                var old = eps[ep];
                var watched = dur > 0 && pos / dur >= WATCHED_RATIO;
                eps[ep] = { lang: lang, position: pos, duration: dur, watched: watched || !!(old && old.watched), updated: Date.now() };
                save();
                return { watched: eps[ep].watched };
            },
            setWatched: function (slug, ep, watched) {
                var eps = h.progress[slug] || (h.progress[slug] = {});
                if (watched) {
                    if (eps[ep]) eps[ep].watched = true;
                    else eps[ep] = { lang: 'sub', position: 0, duration: 0, watched: true, updated: Date.now() };
                } else delete eps[ep];
                save();
            },
            animeProgress: function (slug) {
                var eps = h.progress[slug] || {}, out = {}, last = null, lastEp = null;
                Object.keys(eps).forEach(function (n) {
                    var p = eps[n];
                    out[n] = { position: p.position, duration: p.duration, watched: p.watched, lang: p.lang };
                    if (!last || p.updated > last.updated) { last = p; lastEp = +n; }
                });
                return { episodes: out, last: last ? { episode: lastEp, lang: last.lang, position: last.position } : null };
            },
            continueWatching: function (limit) {
                var out = [];
                Object.keys(h.progress).forEach(function (slug) {
                    var meta = h.anime[slug], eps = h.progress[slug], last = null, lastEp = 0, count = 0;
                    if (!meta) return;
                    Object.keys(eps).forEach(function (n) {
                        if (eps[n].watched) count++;
                        if (!last || eps[n].updated > last.updated) { last = eps[n]; lastEp = +n; }
                    });
                    if (!last) return;
                    var item = JSON.parse(JSON.stringify(meta));
                    item.resume = { episode: lastEp, lang: last.lang, position: last.position, duration: last.duration, watched: last.watched };
                    item.watchedCount = count;
                    item.lastWatched = last.updated / 1000;
                    out.push(item);
                });
                out.sort(function (x, y) { return y.lastWatched - x.lastWatched; });
                return out.slice(0, limit);
            },
            watchedSlugs: function () {
                var s = {};
                Object.keys(h.progress).forEach(function (k) { if (Object.keys(h.progress[k]).length) s[k] = true; });
                return s;
            },
            /* Genres weighted by episodes watched, decaying with a 30-day half-life. */
            genreWeights: function () {
                var now = Date.now(), w = {};
                Object.keys(h.progress).forEach(function (slug) {
                    var meta = h.anime[slug], eps = h.progress[slug], n = 0, last = 0;
                    if (!meta) return;
                    Object.keys(eps).forEach(function (k) { n++; last = Math.max(last, eps[k].updated); });
                    if (!n) return;
                    var decay = Math.pow(0.5, (now - last) / (30 * 86400000));
                    (meta.genres || []).forEach(function (g) { w[g] = (w[g] || 0) + (1 + Math.sqrt(n)) * decay; });
                });
                return w;
            },
            remove: function (slug) { delete h.progress[slug]; save(); },
            clear: function () { h = { anime: {}, progress: {} }; save(); }
        };
    })();

    function recommendations(limit) {
        var weights = History.genreWeights();
        var top = Object.keys(weights).sort(function (x, y) { return weights[y] - weights[x]; }).slice(0, 4);
        if (!top.length) return filter({ sort: 'Score', limit: limit }).then(function (r) { return r.results; });
        // Pairs of favourite genres first (more specific), then singles.
        var queries = top.slice(1, 3).map(function (g) { return [top[0], g]; }).concat(top.map(function (g) { return [g]; }));
        return Promise.all(queries.map(function (g) {
            return filter({ genre: g, sort: 'Score', limit: 24 }).then(function (r) { return r.results.slice(); }, function () { return []; });
        })).then(function (pools) {
            var out = [], used = History.watchedSlugs();
            // Round-robin so one genre doesn't dominate the row.
            while (out.length < limit && pools.some(function (p) { return p.length; })) {
                pools.forEach(function (pool) {
                    while (pool.length) {
                        var a = pool.shift();
                        if (!used[a.slug]) { used[a.slug] = true; out.push(a); break; }
                    }
                });
            }
            return out.slice(0, limit);
        });
    }

    function categoryList() { return CATEGORIES.map(function (c) { return { id: c.id, name: c.name }; }); }

    function withMeta(slug, fn) {
        // History needs the title and artwork; detail() is cached, so this is usually free.
        return detail(slug).then(function (a) { History.rememberAnime(a); }, function () {}).then(fn);
    }

    /* ------------------------------------------------------------ streams */
    function zokoDecode(html) {
        var m = /window\.__P="([^"]+)"/.exec(html);
        if (!m) return null;
        var raw = atob(m[1]), out = '';
        for (var i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ ZOKO_KEY.charCodeAt(i % ZOKO_KEY.length));
        return JSON.parse(decodeURIComponent(escape(out)));
    }

    function isZoko(url) { return url.indexOf('://' + ZOKO_HOST + '/') > 0; }

    /*
     * Episodes carry up to ~40 subtitle tracks in any order, and nearly all are tagged
     * lang "en" whatever the language, so tracks are told apart by label. Only English
     * and Brazilian Portuguese are offered. Lower rank wins; null means never use.
     */
    function subRank(lang, label) {
        var l = String(label || '').toLowerCase();
        if (/forced/.test(l)) return null;  // signs and songs only
        if (lang === 'en') {
            if (!/^english\b/.test(l)) return null;
            if (l === 'english') return 0;
            if (/sdh/.test(l)) return 3;
            return /cr\b|crunchyroll/.test(l) ? 1 : 2;
        }
        if (!/^portugu/.test(l) || /europe|portugal/.test(l)) return null;
        if (/bra[sz]il/.test(l)) return 0;
        return l === 'portuguese' ? 1 : 2;
    }

    function pickSubtitles(tracks) {
        var out = [];
        [['en', 'English'], ['pt', 'Português (BR)']].forEach(function (want) {
            var best = null, bestRank = 99;
            (tracks || []).forEach(function (t) {
                if (!t || !t.src) return;
                var r = subRank(want[0], t.label);
                if (r === null) return;
                if (t['default']) r -= 0.5;
                if (r < bestRank) { best = t; bestRank = r; }
            });
            if (best) out.push({ lang: want[0], label: want[1], url: best.src });
        });
        return out;
    }

    function stream(slug, ep, lang, server) {
        return embedLinks(slug, ep, lang).then(function (links) {
            var usable = links.filter(isZoko);
            if (!usable.length) {
                throw new Error(links.length ? 'This episode only has servers the TV app can\'t play yet'
                                             : 'No ' + lang.toUpperCase() + ' source for episode ' + ep);
            }
            var idx = (server || 0) % usable.length;
            return http('GET', usable[idx], null, 15000).then(function (r) {
                var d = null;
                try { d = r.status === 200 && zokoDecode(r.text); } catch (e) { /* layout changed */ }
                if (!d || !d.src) throw new Error('Could not read the stream (server ' + (idx + 1) + ', HTTP ' + r.status + ')');
                return {
                    url: d.src,
                    referer: ZOKO_REFERER,
                    subtitles: pickSubtitles(d.subtitles),
                    server: idx,
                    servers: usable.length
                };
            });
        });
    }

    /* ---------------------------------------------------------- subtitles */
    var TS_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})/;
    function secs(ts) {
        var m = TS_RE.exec(ts);
        return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0;
    }
    function parseVtt(txt) {
        var cues = [];
        txt.replace(/﻿/g, '').split(/\r?\n\r?\n/).forEach(function (block) {
            var lines = block.trim().split(/\r?\n/).filter(function (l) { return l.trim(); });
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('-->') < 0) continue;
                var parts = lines[i].split('-->');
                var body = lines.slice(i + 1).map(function (l) { return l.replace(/<[^>]+>/g, ''); }).join('\n').trim();
                if (body) cues.push({ start: secs(parts[0]), end: secs(parts[1]), text: body });
                break;
            }
        });
        return cues;
    }

    /* The subtitle host wants the Referer too; only the download API can send it. */
    function downloadText(url, referer) {
        return new Promise(function (resolve, reject) {
            if (typeof tizen === 'undefined' || !tizen.download) {
                http('GET', url).then(function (r) {
                    if (r.status === 200) resolve(r.text); else reject(new Error('HTTP ' + r.status));
                }, reject);
                return;
            }
            var name = 'sub' + Date.now() + '.vtt';
            var req = new tizen.DownloadRequest(url, 'wgt-private-tmp', name, 'ALL', { Referer: referer });
            tizen.download.start(req, {
                oncompleted: function () {
                    tizen.filesystem.resolve('wgt-private-tmp', function (dir) {
                        dir.resolve(name).readAsText(function (txt) {
                            try { dir.deleteFile(dir.fullPath + '/' + name, function () {}, function () {}); } catch (e) { /* tmp is cleared anyway */ }
                            resolve(txt);
                        }, reject, 'UTF-8');
                    }, reject, 'rw');
                },
                onfailed: function (id, e) { reject(new Error(e && e.message || 'download failed')); }
            });
        });
    }

    /* --------------------------------------------------------- public API */
    return {
        abs: function (u) { return u || ''; },
        status: function () {
            return resolve(false).then(function () {
                return { site: mirror.site, api: mirror.api, domains: candidates() };
            });
        },
        setDomains: function (list) {
            store(K_DOMAINS, (list || []).map(cleanDomain).filter(function (d) {
                return d && d.length < 100 && d.indexOf('.') > 0 && d.indexOf(' ') < 0;
            }));
            return resolve(true).then(function () { return { site: mirror.site, api: mirror.api, domains: candidates() }; });
        },
        userDomains: function () { return load(K_DOMAINS, []); },
        home: function () {
            return Promise.all([catalogHome(), recommendations(24).catch(function () { return []; })]).then(function (r) {
                var d = r[0];
                d['continue'] = History.continueWatching(20);
                d.recommended = r[1];
                d.categories = categoryList();
                return d;
            });
        },
        category: category,
        categories: function () { return Promise.resolve(categoryList()); },
        search: search,
        anime: detail,
        watched: function () { return Promise.resolve({ results: History.continueWatching(200) }); },
        forget: function (slug) { History.remove(slug); return Promise.resolve({ ok: true }); },
        clearHistory: function () { History.clear(); return Promise.resolve({ ok: true }); },
        recommended: function () { return recommendations(48).then(function (r) { return { results: r }; }); },
        stream: stream,
        subtitles: function (url, referer) {
            return downloadText(url, referer || ZOKO_REFERER).then(function (t) { return { cues: parseVtt(t) }; });
        },
        progress: function (p) {
            return withMeta(p.slug, function () { return History.saveProgress(p.slug, p.episode, p.lang, p.position, p.duration); });
        },
        markWatched: function (slug, ep, watched) {
            return withMeta(slug, function () { History.setWatched(slug, ep, watched); return { ok: true }; });
        }
    };
})();
