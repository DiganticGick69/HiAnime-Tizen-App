/* Samsung remote key codes, plus keyboard equivalents for desktop testing. */
var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
    FF: 417, RW: 412, NEXT: 10233, PREV: 10232,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    CH_UP: 427, CH_DOWN: 428
};

var IS_TIZEN = typeof tizen !== 'undefined' && !!tizen.tvinputdevice;

(function registerKeys() {
    if (!IS_TIZEN) return;
    var wanted = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
                  'MediaRewind', 'MediaTrackNext', 'MediaTrackPrevious', 'ColorF0Red', 'ColorF1Green',
                  'ColorF2Yellow', 'ColorF3Blue', 'ChannelUp', 'ChannelDown',
                  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    try {
        tizen.tvinputdevice.registerKeyBatch(wanted);
    } catch (e) {
        for (var i = 0; i < wanted.length; i++) {
            try { tizen.tvinputdevice.registerKey(wanted[i]); } catch (ignored) { /* key not on this model */ }
        }
    }
})();

function isBack(code) { return code === KEY.BACK || code === KEY.ESC || code === KEY.BACKSPACE; }
