/* Shared UI builders: cards, rows, grids, toasts. */
var UI = (function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function h(tag, cls, html) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        if (html != null) el.innerHTML = html;
        return el;
    }

    // Lazy-load background images: the TV has little memory and slow decoding.
    var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].isIntersecting) {
                var t = entries[i].target;
                t.style.backgroundImage = 'url("' + t.getAttribute('data-bg') + '")';
                observer.unobserve(t);
            }
        }
    }, { rootMargin: '400px 1200px' }) : null;

    function lazyBg(el, url) {
        if (!url) return;
        url = Api.abs(url);
        if (observer) { el.setAttribute('data-bg', url); observer.observe(el); }
        else el.style.backgroundImage = 'url("' + url + '")';
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
        var s = (hh ? hh + ':' + (mm < 10 ? '0' : '') : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
        return s;
    }

    function badges(a) {
        var out = '';
        if (a.sub) out += '<span class="badge sub"><span class="ico">' + icon('cc') + '</span>' + a.sub + '</span>';
        if (a.dub) out += '<span class="badge dub"><span class="ico">' + icon('mic') + '</span>' + a.dub + '</span>';
        return out;
    }

    function metaLine(a) {
        var parts = [];
        if (a.type) parts.push(a.type);
        if (a.episodes) parts.push(a.episodes + ' eps');
        else if (a.status) parts.push(a.status);
        return parts.join(' • ');
    }

    /* Poster card. opts: {group, wide, onEnter, onFocus, flag} */
    function card(a, opts) {
        opts = opts || {};
        var c = h('div', 'card focusable' + (opts.wide ? ' wide' : ''));
        c.setAttribute('data-group', opts.group || 'grid');
        var img = h('div', 'card-img');
        lazyBg(img, opts.wide ? (a.banner || a.image) : a.image);
        var inner = '<div class="card-badges">' + badges(a) + '</div>';
        if (opts.flag) inner += '<div class="card-flag">' + esc(opts.flag) + '</div>';
        var r = a.resume;
        if (r && r.duration > 0 && !r.watched) {
            inner += '<div class="card-progress"><i style="width:' + Math.min(100, 100 * r.position / r.duration).toFixed(1) + '%"></i></div>';
        }
        img.innerHTML = inner;
        c.appendChild(img);
        c.appendChild(h('div', 'card-name', esc(a.title)));
        var meta = opts.meta != null ? opts.meta : metaLine(a);
        c.appendChild(h('div', 'card-meta', esc(meta)));
        c._enter = opts.onEnter || function () { App.go('detail', { slug: a.slug }); };
        if (opts.onFocus) c._focus = function () { opts.onFocus(a); };
        c._anime = a;
        return c;
    }

    /* Horizontal row. opts: {wide, hint, cardOpts(a) } */
    function row(title, items, opts) {
        opts = opts || {};
        var id = 'row-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        var r = h('section', 'row');
        r.innerHTML = '<div class="row-head"><div class="row-title">' + esc(title) + '</div>' +
            (opts.hint ? '<div class="row-hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
        var track = h('div', 'row-track' + (opts.wide ? ' wide' : ''));
        var strip = h('div', 'row-strip');
        for (var i = 0; i < items.length; i++) {
            var o = opts.cardOpts ? opts.cardOpts(items[i]) : {};
            o.group = id;
            o.wide = opts.wide;
            strip.appendChild(card(items[i], o));
        }
        track.appendChild(strip);
        r.appendChild(track);
        return r;
    }

    function grid(items, group, cardOpts) {
        var g = h('div', 'grid');
        appendGrid(g, items, group, cardOpts);
        return g;
    }

    function appendGrid(g, items, group, cardOpts) {
        for (var i = 0; i < items.length; i++) {
            var o = cardOpts ? cardOpts(items[i]) : {};
            o.group = group;
            g.appendChild(card(items[i], o));
        }
    }

    var toastTimer = null;
    function toast(msg, ms) {
        var t = document.getElementById('toast');
        t.textContent = msg;
        t.classList.remove('hidden');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 3500);
    }

    function spinner() { return h('div', 'spinner view-spinner'); }

    return {
        esc: esc, h: h, lazyBg: lazyBg, fmtTime: fmtTime, badges: badges, metaLine: metaLine,
        card: card, row: row, grid: grid, appendGrid: appendGrid, toast: toast, spinner: spinner
    };
})();
