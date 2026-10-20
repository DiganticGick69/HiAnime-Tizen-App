/* Client for the LAN backend. The TV never talks to the anime site directly. */
var Api = (function () {
    var STORE_KEY = 'hianime.backend';

    function defaultBase() {
        // When previewing from the backend itself (http://host:8787/app/) use that origin.
        if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
        return '';
    }

    function getBase() {
        var saved = null;
        try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* storage unavailable */ }
        return (saved || defaultBase()).replace(/\/+$/, '');
    }

    function setBase(url) {
        url = (url || '').trim().replace(/\/+$/, '');
        if (url && !/^https?:\/\//.test(url)) url = 'http://' + url;
        if (url && !/:\d+$/.test(url.replace(/^https?:\/\//, ''))) url += ':8787';
        try { localStorage.setItem(STORE_KEY, url); } catch (e) { /* storage unavailable */ }
        return url;
    }

    function abs(path) {
        if (!path) return '';
        if (/^https?:\/\//.test(path)) return path;
        return getBase() + path;
    }

    function request(method, path, body, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var base = getBase();
            if (!base) { reject(new Error('Backend address not set')); return; }
            var xhr = new XMLHttpRequest();
            xhr.open(method, base + path, true);
            xhr.timeout = timeoutMs || 20000;
            if (body) xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () {
                var data = null;
                try { data = JSON.parse(xhr.responseText); } catch (e) { /* non-JSON */ }
                if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                else reject(new Error((data && (data.detail || data.error)) || ('HTTP ' + xhr.status)));
            };
            xhr.onerror = function () { reject(new Error('Cannot reach backend at ' + base)); };
            xhr.ontimeout = function () { reject(new Error('Backend timed out')); };
            xhr.send(body ? JSON.stringify(body) : null);
        });
    }

    function enc(s) { return encodeURIComponent(s); }

    return {
        getBase: getBase,
        setBase: setBase,
        abs: abs,
        status: function () { return request('GET', '/api/status', null, 8000); },
        home: function () { return request('GET', '/api/home', null, 30000); },
        category: function (id, page) { return request('GET', '/api/category/' + enc(id) + '?page=' + (page || 1)); },
        categories: function () { return request('GET', '/api/categories'); },
        search: function (q) { return request('GET', '/api/search?q=' + enc(q)); },
        anime: function (slug) { return request('GET', '/api/anime/' + enc(slug)); },
        watched: function () { return request('GET', '/api/watched'); },
        forget: function (slug) { return request('DELETE', '/api/watched/' + enc(slug)); },
        recommended: function () { return request('GET', '/api/recommended', null, 30000); },
        stream: function (slug, ep, lang, server) {
            return request('GET', '/api/stream?slug=' + enc(slug) + '&ep=' + ep + '&lang=' + lang +
                '&server=' + (server || 0), null, 90000);
        },
        subtitles: function (url) { return request('GET', url, null, 20000); },
        progress: function (p) { return request('POST', '/api/progress', p); },
        markWatched: function (slug, ep, watched) {
            return request('POST', '/api/watched', { slug: slug, episode: ep, watched: watched });
        },
        setDomains: function (list) { return request('POST', '/api/settings/domains', { domains: list }, 60000); },
        refreshFilters: function () { return request('POST', '/api/settings/refresh-filters', null, 120000); }
    };
})();
