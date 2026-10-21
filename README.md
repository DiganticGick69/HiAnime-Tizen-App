# HiAnime Tizen App

A Netflix-style TV app for browsing and watching anime from HiAnime (`hianimes.se` and its mirrors) on a Samsung Smart TV. It targets the **Samsung UN55RU7100 (2019, Tizen 5.0)**.

**Everything runs on the TV.** There's no server, no PC to leave on, and no account.

- **Browse:** a spotlight banner, Continue Watching, Recommended for You, Trending, Latest Episodes, Most Popular, New on HiAnime, and category rows (Isekai, Action, Fantasy, Romance, Sci-Fi, and more).
- **Search:** an on-screen keyboard driven by the remote, with live results.
- **Details:** synopsis, score, status, air dates and genres. You can switch between **SUB and DUB**, and pick episodes from a grid split into ranges for long series like One Piece.
- **Watch tracking:** every episode shows as watched (✓), in progress (progress bar) or not watched. You can mark episodes manually with the RED button.
- **Watched tab:** everything you've started, with progress, so you can pick up where you left off.
- **Player:** Samsung's native AVPlay with resume, ±10 s seeking, previous/next episode, auto-play of the next episode, sub/dub switching mid-episode and English or Brazilian Portuguese subtitles.
- **No ads:** the site's pages and player scripts never run. The app reads only the data it needs.

## How it works

```
                    ┌──────────────────────────────────────────────┐
                    │  Samsung TV — HiAnime app (Chromium 63)      │
                    │                                              │
  site mirrors ◀────│  mirror discovery (reads the site's JS)      │
  catalog API  ◀────│  catalog, search, details, episode lists     │
  embed page   ◀────│  stream link (HTML only, decoded on the TV)  │
  video host   ◀────│  AVPlay, sends the player's Referer          │
  subtitles    ◀────│  tizen.download with Referer → own overlay   │
                    │  watch history in localStorage               │
                    └──────────────────────────────────────────────┘
```

- **Catalog:** the site is a Next.js front end on top of a JSON API. The app tries the known mirrors (plus any you add under **Settings → Site mirrors**), reads the site's JS bundle and pulls the current API address out of it, so following a mirror change means typing one domain. The API that works is remembered and only re-checked when it stops answering.
- **Streams:** each episode lists player links. The app fetches the zokoanime player page as plain text and decodes the HLS link from it (`window.__P`, XOR with `otaku-embed-v1`, then base64). None of the page's scripts or ads run.
- **Referer:** the video host only answers requests that carry `Referer: https://zokoanime.video/`. Web code can't set that header, but AVPlay copies its `USER_AGENT` property into the request as-is, so the app appends a `Referer` line to it. Subtitle files need the same header, so they're fetched with Tizen's download API, which accepts headers, and drawn by the app's own subtitle overlay.
- Why this route: [`tv-playback-test/`](tv-playback-test/) tried every option on the real TV. See its [results](tv-playback-test/README.md#results-on-the-un55ru7100-tizen-50-2026-10-21).

## Privacy

- **Watch history stays on the TV** (`localStorage`) and is never sent anywhere. **Settings → Clear watch history** removes it.
- **Only whitelisted fields are kept** from catalog records: titles, artwork, synopsis, genres, basic facts and episode numbers.
- **The app never navigates away** from its own page, and nothing from the site's pages is executed.
- **Network contacts:** the site mirrors (only when finding the API), the catalog API, the artwork host, `zokoanime.video` (player page HTML) and the video host.

## Setup

1. **Turn on Developer Mode on the TV.** Open **Apps**, press `1 2 3 4 5` on the remote, switch Developer Mode **On**, enter your PC's IP address, then restart the TV.
2. **Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)** with the *TV Extensions* and *Samsung Certificate Extension* packages.
3. **Create a Samsung certificate profile** in Tizen Studio's Certificate Manager (TV → Samsung). Add your TV's DUID by connecting to the TV once in Device Manager. Name the profile `HiAnime`, or set `TIZEN_PROFILE`.
4. **Build and install:**
   ```bash
   export PATH="$PATH:$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools"
   ./scripts/build-wgt.sh 192.168.1.40      # your TV's IP
   ```
5. **Open HiAnime from Apps.** It finds the site by itself. If the site has moved, add the new domain under **Settings → Site mirrors**.

You only need the PC for installing. After that the app runs on its own.

Previewing in a desktop browser shows the UI, but videos won't play there: a desktop browser can't send the Referer the video host requires.

## Remote controls

| Where | Key | Action |
| --- | --- | --- |
| Everywhere | Arrows / OK / Back | Navigate / select / go back |
| Rows | ← from the first card | Open the side menu |
| Home spotlight | ← / → on the buttons | Previous / next featured anime |
| Episode grid | RED | Mark the episode as watched or not watched |
| Watched tab | PLAY / RED | Resume right away / remove from the list |
| Player (controls hidden) | ← / → | Seek −10 s / +10 s |
| Player (controls hidden) | OK | Pause / play |
| Player | ⏯ ⏪ ⏩ ⏹ | Media keys |
| Player | CH▲ / CH▼ | Next / previous episode |
| Player | RED / GREEN / YELLOW | Switch SUB↔DUB / subtitles English → Português (BR) → off / try the next server |
| Player | Back | Hide the controls, then exit the player |

An episode counts as **watched** once you pass 90% of it.

## Limits

- **Only zokoanime player links are used.** Episodes also list megaplay links, which the app can't play yet. In testing, every episode checked had a zokoanime link.
- **Subtitles are English or Brazilian Portuguese only** (English by default; the choice is remembered). Episodes carry up to ~40 tracks in random order and almost all are tagged `en` whatever the language, so tracks are picked by label (`subRank` in `tizen-app/js/api.js`). "Forced" tracks (signs only) and European Portuguese are skipped. Some episodes have no Portuguese track, and a few have no soft subtitles at all.
- If the player site changes how it encodes the stream link, episodes fail with "Could not read the stream". The decoder is `zokoDecode` in `tizen-app/js/api.js`.

## Project layout

```
tizen-app/
  config.xml         Tizen 5.0 TV manifest
  index.html, css/style.css
  js/api.js          mirrors, catalog, streams, subtitles, watch history (all on the TV)
  js/nav.js          spatial navigation for the remote
  js/player.js       AVPlay engine (TV) / hls.js engine (desktop preview), OSD, subtitles
  js/views.js        Home, Details, Search, Categories, Watched, Settings
tv-playback-test/    the test app that picked the playback method (results in its README)
scripts/             build/install, icon generator
```

To build the test app instead of the main one: `APP_DIR=tv-playback-test ./scripts/build-wgt.sh <TV-IP>`.

The earlier version used a backend server (headless Firefox + uBlock Origin) and is in the git history before the TV-only rewrite.

## Disclaimer

This project is a client for a third-party website and doesn't host or distribute any media. You're responsible for making sure that what you stream is legal where you live.
