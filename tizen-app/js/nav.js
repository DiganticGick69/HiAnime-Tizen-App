/*
 * Spatial navigation for the remote's arrow keys.
 *
 * Any element with class "focusable" inside the current scope can take focus.
 * Moving picks the nearest element in the pressed direction. Elements share a
 * data-group (a row, a grid, the sidebar); when entering a group from outside,
 * the element last focused in that group is restored, like Netflix rows.
 */
var Nav = (function () {
    var scope = document;
    var current = null;
    var memory = {};
    var lastContent = null;
    var scrollAnim = null;

    function visible(el) {
        return el.offsetParent !== null && !el.classList.contains('disabled-nav');
    }

    function candidates() {
        var all = scope.querySelectorAll('.focusable');
        var out = [];
        for (var i = 0; i < all.length; i++) if (visible(all[i])) out.push(all[i]);
        return out;
    }

    function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    function groupOf(el) { return el ? (el.getAttribute('data-group') || '') : ''; }

    function best(dir) {
        if (!current) return null;
        var cr = current.getBoundingClientRect();
        var c = center(cr);
        var list = candidates();
        var winner = null, winScore = Infinity;
        var horizontal = dir === 'left' || dir === 'right';
        for (var i = 0; i < list.length; i++) {
            var el = list[i];
            if (el === current) continue;
            var r = el.getBoundingClientRect();
            var p = center(r);
            var dx = p.x - c.x, dy = p.y - c.y;
            var primary, secondary;
            if (dir === 'right') { if (r.left < cr.right - 8 && dx <= 8) continue; primary = dx; secondary = Math.abs(dy); }
            else if (dir === 'left') { if (r.right > cr.left + 8 && dx >= -8) continue; primary = -dx; secondary = Math.abs(dy); }
            else if (dir === 'down') { if (r.top < cr.bottom - 8 && dy <= 8) continue; primary = dy; secondary = Math.abs(dx); }
            else { if (r.bottom > cr.top + 8 && dy >= -8) continue; primary = -dy; secondary = Math.abs(dx); }
            if (primary <= 0) continue;
            // Stay in the same row when moving sideways; overlap matters most vertically.
            var overlap = horizontal
                ? Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top)
                : Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
            var score = primary + secondary * (horizontal ? 4 : 1.2) - (overlap > 0 ? 400 : 0);
            if (score < winScore) { winScore = score; winner = el; }
        }
        return winner;
    }

    function stillUsable(el) {
        return el && document.body.contains(el) && scope.contains(el) && visible(el);
    }

    function move(dir) {
        var fromGroup = groupOf(current);
        // Leaving the sidebar to the right returns to where the user was.
        if (fromGroup === 'sidebar' && dir === 'right') {
            if (stillUsable(lastContent)) { focus(lastContent); return true; }
        }
        var next = best(dir);
        if (!next) return false;
        var g = groupOf(next);
        if (g && g !== fromGroup && g !== 'sidebar' && stillUsable(memory[g])) next = memory[g];
        focus(next);
        return true;
    }

    function animateScroll(el, target) {
        if (scrollAnim) cancelAnimationFrame(scrollAnim);
        var start = el.scrollTop, diff = target - start, t0 = null;
        if (Math.abs(diff) < 2) { el.scrollTop = target; return; }
        function step(ts) {
            if (t0 === null) t0 = ts;
            var k = Math.min(1, (ts - t0) / 180);
            k = 1 - Math.pow(1 - k, 3);
            el.scrollTop = start + diff * k;
            if (k < 1) scrollAnim = requestAnimationFrame(step);
        }
        scrollAnim = requestAnimationFrame(step);
    }

    function reveal(el) {
        // Horizontal rows: slide the strip so the focused card is visible.
        var strip = el.parentNode;
        if (strip && strip.classList && strip.classList.contains('row-strip')) {
            var track = strip.parentNode;
            var maxX = Math.max(0, strip.scrollWidth - track.clientWidth + 120);
            var x = Math.max(0, Math.min(el.offsetLeft - 40, maxX));
            strip.style.transform = 'translateX(' + (-x) + 'px)';
        }
        // Vertical: keep the element (or its row) inside the scroller.
        var scroller = el.closest ? el.closest('.scroller') : null;
        if (!scroller) return;
        if (el.hasAttribute('data-scroll-top')) { animateScroll(scroller, 0); return; }
        var box = (el.closest('.row') || el).getBoundingClientRect();
        var sr = scroller.getBoundingClientRect();
        var top = box.top - sr.top, bottom = box.bottom - sr.top;
        var margin = 90;
        var target = scroller.scrollTop;
        if (top < margin) target += top - margin;
        else if (bottom > sr.height - 40) target += bottom - sr.height + 40 + (box.height > sr.height - margin ? 0 : 0);
        animateScroll(scroller, Math.max(0, target));
    }

    function focus(el) {
        if (!el) return;
        if (current && current !== el) {
            current.classList.remove('focused');
            if (current._blur) current._blur();
        }
        current = el;
        el.classList.add('focused');
        var g = groupOf(el);
        if (g) memory[g] = el;
        if (g !== 'sidebar') lastContent = el;
        var sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open', g === 'sidebar');
        reveal(el);
        if (el._focus) el._focus();
    }

    function focusFirst(selector) {
        var el = selector ? scope.querySelector(selector) : null;
        if (!el || !visible(el)) el = candidates()[0];
        if (el) focus(el);
    }

    return {
        setScope: function (el) { scope = el || document; },
        resetMemory: function () { memory = {}; lastContent = null; },
        move: move,
        focus: focus,
        focusFirst: focusFirst,
        current: function () { return current; },
        lastContent: function () { return lastContent; },
        enter: function () { if (current && current._enter) { current._enter(); return true; } return false; }
    };
})();
