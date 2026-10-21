# Playback test app

A small throwaway Tizen app that checks which ways of playing video work on your TV.
Its results decide how the TV-only version of HiAnime plays episodes.

## Install

Set up Tizen Studio, Developer Mode and the certificate as described in the main README, then:

```bash
APP_DIR=tv-playback-test ./scripts/build-wgt.sh <TV-IP>
```

Or in Tizen Studio: **File → Import → Tizen → Tizen Project**, pick the `tv-playback-test` folder, then right-click → **Run As → Tizen Web Application**.

## Use

Open **HiAnime Test** from Apps and run tests 1 to 7 **in order** (Up/Down + OK, or the number keys).
For tests 5 and 6 the player opens full screen: press **OK** if video is playing, **Back** if not.

Then send back a photo of the screen. The log at the bottom matters too.

| Test | Checks |
| --- | --- |
| 1 | The TV can read the catalog directly |
| 2 | The TV can read the zokoanime episode page and pull out the stream link |
| 3 | The video host accepts requests from the TV without a Referer header (probably FAIL) |
| 4 | Samsung's own player (AVPlay) can play that stream, with the Referer added through the `COOKIE` property |
| 5 | The site's zokoanime player runs inside the app |
| 6 | The site's megaplay player runs inside the app |
| 7 | The subtitle file downloads with the Referer (Tizen download API) and can be read back |

## Results on the UN55RU7100 (Tizen 5.0, 2026-10-21)

| Test | Result | Notes |
| --- | --- | --- |
| 1 | PASS | Catalog API answers the TV directly (CORS is fine) |
| 2 | PASS | Embed page fetched and `window.__P` decoded on the TV |
| 3 | FAIL (403, expected) | The video host (`hls.dramahot.top`) wants exactly `Referer: https://zokoanime.video/`. No Referer, another site's Referer, or `Origin` alone all get 403. |
| 4 | **PASS** | AVPlay plays once the Referer goes in through `setStreamingProperty('COOKIE', 'a=1\r\nReferer: https://zokoanime.video/')` (the value is copied into the request headers as-is, so the CRLF adds a header line; `USER_AGENT` works the same way). Without it: `PLAYER_ERROR_CONNECTION_FAILED`. Checked: 1080p adaptive, seek to 10:00, 23-min episode. `|Referer=` URL suffixes, `CUSTOM_MESSAGE` and `HTTP_HEADER` don't work. |
| 5 | FAIL | The zokoanime player needs `import.meta` (Chromium 64+); Chromium 63 can't parse it, so the frame stays black. |
| 6 | Unconfirmed | No messages from the megaplay player and no screenshot; not needed now. |
| 7 | PASS | Subtitles (`.vtt`, same host, same Referer rule) download with `tizen.DownloadRequest(url, 'wgt-private-tmp', name, 'ALL', {Referer})` and read back through `tizen.filesystem`. `setExternalSubtitlePath` only takes local files, and XHR can't set Referer. |

So the TV-only app uses the **Test 4 PASS** route below, with subtitles from test 7's method, drawn by the app's own subtitle overlay.

## Next step (notes for Claude)

When the user shares the test results (a photo or a list of PASS/FAIL), rebuild `tizen-app/` as a **TV-only app with no backend**:

- **Always TV-only (whatever the results):** catalog, search, categories, details and images come straight from the site's API (`https://animehot.cc/api`, found through the mirror domain).
  - `POST /search {title}`, `POST /filter {genre:[...], keyword, sort, page, limit}`, `GET /home`, `GET /anime/{slug}`
  - Full episode lists come from `GET /episodes/{anime _id}?start=1&end=100000`.
  - Watch history and recommendations move to the TV's `localStorage`.
  - Port the logic in `backend/hianime_backend/catalog.py`, `history.py` and `server.py` (`_recommendations`) to JS.
- **Playback, depending on the results:**
  - **Test 4 PASS:** decode the zokoanime page on the TV (`window.__P`, XOR key `otaku-embed-v1` + base64, see `zokoDecode` in `test.js`) and play `src` with AVPlay. Subtitles are in `subtitles[]`.
  - **Test 5 PASS (and 4 FAIL):** play through a full-screen zokoanime iframe, driven by our own controls using its postMessage bridge (`{channel:'zokoanime', type:'play'|'pause'|'seek'|'state'}`). It emits `ready`, `time`, `ended` and similar events. Keep focus out of the iframe and restrict `tizen:allow-navigation`.
  - **Test 6 PASS only:** same iframe approach with megaplay.
  - **All of 4, 5 and 6 FAIL:** a TV-only app can't play video. Tell the user, and offer the existing backend as an optional playback helper.
- **Constraints:**
  - Tizen 5.0 = Chromium 63: no optional chaining, `??`, CSS `inset` or flex `gap`.
  - Commit as the repo's local git identity: the GitHub no-reply address, never personal info.
