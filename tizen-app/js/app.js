/* Router, history stack and global key handling. */
var App = (function () {
    var view = document.getElementById('view');
    var stack = [];          // [{name, params, focusPath}]
    var currentName = null;
    var pendingFocus = null;
    var exitArmed = 0;

    // A focus "path" is the element's index among the view's focusables, which
    // survives a re-render as long as the content order is the same.
    function focusPath() {
        var cur = Nav.current();
        if (!cur || !view.contains(cur)) return null;
        var all = view.querySelectorAll('.focusable');
        return { index: Array.prototype.indexOf.call(all, cur), scroll: view.scrollTop };
    }

    function setActiveNav(name) {
        var items = document.querySelectorAll('#sidebar .nav-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', items[i].getAttribute('data-route') === name);
        }
    }

    function show(name, params) {
        currentName = name;
        setActiveNav(name === 'detail' ? (stack.length > 1 ? stack[stack.length - 2].name : 'home') : name);
        view.scrollTop = 0;
        Views[name].render(view, params || {});
        renderIcons(view);
    }

    function go(name, params, replace) {
        var here = focusPath();
        if (stack.length) stack[stack.length - 1].focus = here;
        if (replace && stack.length) stack.pop();
        // Top-level sections reset the stack, like a TV app's main menu.
        if (name !== 'detail') stack = [];
        stack.push({ name: name, params: params || {} });
        // A replace (retry, refresh) keeps the user's place on the screen.
        pendingFocus = replace ? here : null;
        show(name, params);
    }

    function back() {
        if (stack.length > 1) {
            stack.pop();
            var prev = stack[stack.length - 1];
            pendingFocus = prev.focus;
            show(prev.name, prev.params);
            return;
        }
        if (currentName !== 'home') { go('home'); return; }
        var cur = Nav.current();
        if (cur && cur.getAttribute('data-group') !== 'sidebar') {
            Nav.focus(document.querySelector('#sidebar [data-route="home"]'));
            return;
        }
        if (Date.now() - exitArmed < 2500) {
            try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* desktop */ }
            return;
        }
        exitArmed = Date.now();
        UI.toast('Press Back again to exit');
    }

    function restoreFocus() {
        var p = pendingFocus;
        pendingFocus = null;
        if (!p || p.index < 0) return false;
        var all = view.querySelectorAll('.focusable');
        var el = all[Math.min(p.index, all.length - 1)];
        if (!el) return false;
        view.scrollTop = p.scroll || 0;
        Nav.focus(el);
        return true;
    }

    function rememberFocus() {
        if (stack.length) stack[stack.length - 1].focus = focusPath();
    }

    function afterPlayer(anime) {
        // Re-render so watched marks and progress bars are up to date.
        var top = stack[stack.length - 1];
        if (!top) { go('home'); return; }
        pendingFocus = top.focus;
        show(top.name, top.params);
    }

    function onKey(ev) {
        var code = ev.keyCode;
        var active = document.activeElement;
        // Native text inputs (Settings) own the keyboard until Done/Back.
        if (active && active.tagName === 'INPUT') {
            if (code === KEY.ENTER || code === 65376 || isBack(code) && code !== KEY.BACKSPACE || code === 65385 ||
                code === KEY.UP || code === KEY.DOWN) {
                active.blur();
                ev.preventDefault();
                if (code === KEY.UP) Nav.move('up');
                if (code === KEY.DOWN) Nav.move('down');
            }
            return;
        }
        if (Player.isActive()) { ev.preventDefault(); Player.handleKey(code); return; }

        var v = Views[currentName];
        if (v && v.key && v.key(code, ev)) { ev.preventDefault(); return; }

        switch (code) {
            case KEY.LEFT:
                if (!Nav.move('left') && Nav.current() && Nav.current().getAttribute('data-group') !== 'sidebar') {
                    Nav.focus(document.querySelector('#sidebar .nav-item.active') || document.querySelector('#sidebar .nav-item'));
                }
                break;
            case KEY.RIGHT: Nav.move('right'); break;
            case KEY.UP: Nav.move('up'); break;
            case KEY.DOWN: Nav.move('down'); break;
            case KEY.ENTER: Nav.enter(); break;
            default:
                if (isBack(code)) { back(); break; }
                return;
        }
        ev.preventDefault();
    }

    function init() {
        renderIcons(document);
        var items = document.querySelectorAll('#sidebar .nav-item');
        for (var i = 0; i < items.length; i++) {
            (function (it) { it._enter = function () { go(it.getAttribute('data-route')); }; })(items[i]);
        }
        Player.init();
        document.addEventListener('keydown', onKey);
        go('home');
    }

    return {
        init: init, go: go, back: back, restoreFocus: restoreFocus,
        rememberFocus: rememberFocus, afterPlayer: afterPlayer
    };
})();

window.addEventListener('load', App.init);
