/* Minimal inline SVG icon set (24x24 paths). */
var ICONS = {
    home: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
    search: 'M10 3a7 7 0 015.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1110 3zm0 2a5 5 0 100 10 5 5 0 000-10z',
    grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
    history: 'M13 3a9 9 0 11-8.5 12h2.1A7 7 0 1013 5a7 7 0 00-5.6 2.8L10 10H3V3l2.4 2.4A9 9 0 0113 3zm-1 4h2v5l4 2.4-1 1.7-5-3z',
    gear: 'M12 8a4 4 0 110 8 4 4 0 010-8zm8.6 5.5l2 1.6-2 3.4-2.4-1a8 8 0 01-2.2 1.3L15.6 21h-4l-.4-2.6a8 8 0 01-2.2-1.3l-2.4 1-2-3.4 2-1.6a8 8 0 010-2.6l-2-1.6 2-3.4 2.4 1a8 8 0 012.2-1.3L11.6 3h4l.4 2.6a8 8 0 012.2 1.3l2.4-1 2 3.4-2 1.6a8 8 0 010 2.6z',
    play: 'M7 4l13 8-13 8z',
    pause: 'M6 4h4v16H6zm8 0h4v16h-4z',
    info: 'M12 2a10 10 0 110 20 10 10 0 010-20zm-1 8v7h2v-7zm0-4v2h2V6z',
    prev: 'M6 5h2v14H6zm3.5 7L19 5v14z',
    next: 'M16 5h2v14h-2zM5 5l9.5 7L5 19z',
    rew: 'M11 6v12L2.5 12zm9 0v12l-8.5-6z',
    ffw: 'M13 6v12l8.5-6zM4 6v12l8.5-6z',
    cc: 'M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm3 5a2 2 0 00-2 2 2 2 0 002 2h2v-1.5H7.5v-1H9V10zm7 0a2 2 0 00-2 2 2 2 0 002 2h2v-1.5h-1.5v-1H16V10z',
    mic: 'M12 3a3 3 0 013 3v6a3 3 0 01-6 0V6a3 3 0 013-3zm-7 9h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V21h-2v-2.1A7 7 0 015 12z',
    check: 'M9 16.2l-4.2-4.2-1.4 1.4L9 19 21 7l-1.4-1.4z',
    trash: 'M6 7h12l-1 14H7zm3-4h6l1 2h4v2H4V5h4z',
    star: 'M12 2l3 7 7.5.6-5.7 4.9 1.8 7.4L12 18l-6.6 3.9 1.8-7.4L1.5 9.6 9 9z'
};

function icon(name) {
    return '<svg viewBox="0 0 24 24"><path d="' + (ICONS[name] || '') + '"/></svg>';
}

function renderIcons(root) {
    var els = (root || document).querySelectorAll('[data-icon]');
    for (var i = 0; i < els.length; i++) {
        if (!els[i].firstChild) els[i].innerHTML = icon(els[i].getAttribute('data-icon'));
    }
}
