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

Open **HiAnime Test** from Apps and run tests 1 to 6 **in order** (Up/Down + OK, or the number keys).
For tests 5 and 6 the player opens full screen: press **OK** if video is playing, **Back** if not.

Then send back a photo of the screen. The log at the bottom matters too.

| Test | Checks |
| --- | --- |
| 1 | The TV can read the catalog directly |
| 2 | The TV can read the zokoanime episode page and pull out the stream link |
| 3 | The video host accepts requests from the TV without a Referer header (probably FAIL) |
| 4 | Samsung's own player (AVPlay) can play that stream |
| 5 | The site's zokoanime player runs inside the app |
| 6 | The site's megaplay player runs inside the app |

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
