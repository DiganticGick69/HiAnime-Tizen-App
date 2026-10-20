/* On-screen keyboard for the remote (the TV's IME is slow to drive with arrows). */
var Keyboard = (function () {
    var LAYOUT = 'abcdefghijklmnopqrstuvwxyz1234567890'.split('');

    /* Builds keys into `container`; onChange(text) fires on every edit. */
    function create(container, onChange) {
        var text = '';
        function key(label, cls, fn) {
            var k = UI.h('div', 'key focusable' + (cls ? ' ' + cls : ''), label);
            k.setAttribute('data-group', 'kb');
            k._enter = fn;
            container.appendChild(k);
            return k;
        }
        function set(v) { text = v.slice(0, 60); onChange(text); }
        for (var i = 0; i < LAYOUT.length; i++) {
            (function (ch) { key(ch, '', function () { set(text + ch); }); })(LAYOUT[i]);
        }
        key('space', 'wide', function () { if (text && text.slice(-1) !== ' ') set(text + ' '); });
        key('⌫', 'wide', function () { set(text.slice(0, -1)); });
        key('clear', 'wide', function () { set(''); });
        return {
            value: function () { return text; },
            set: set,
            type: function (ch) { set(text + ch); },
            backspace: function () { set(text.slice(0, -1)); }
        };
    }

    return { create: create };
})();
