# HiAnime Tizen App

A Netflix-style TV app for browsing and watching anime from HiAnime (`hianimes.se` and its mirrors) on a Samsung Smart TV. It's built and tested for the **Samsung UN55RU7100 (2019, Tizen 5.0)**.

- **Browse:** a spotlight banner, Continue Watching, Recommended for You, Trending, Latest Episodes, Most Popular, New on HiAnime, and category rows (Isekai, Action, Fantasy, Romance, Sci-Fi, and more).
- **Search:** an on-screen keyboard driven by the remote, with live results.
- **Details:** synopsis, score, status, air dates and genres. You can switch between **SUB and DUB**, and pick episodes from a grid split into ranges for long series like One Piece.
- **Watch tracking:** every episode shows as watched (✓), in progress (progress bar) or not watched. You can mark episodes manually with the RED button.
- **Watched tab:** everything you've started, with progress, so you can pick up where you left off.
- **Player:** native AVPlay with resume, ±10 s seeking, previous/next episode, auto-play of the next episode, sub/dub switching mid-episode, subtitles and server fallback.
- **Ad blocking:** uBlock Origin filter lists (plus EasyList, EasyPrivacy and Peter Lowe's list). Pop-ups and new tabs are killed.

## How it works

```
 ┌──────────────┐   LAN (JSON, images, HLS)   ┌─────────────────────────────────────────┐
 │  Samsung TV  │ ──────────────────────────▶ │  Backend (PC / Raspberry Pi, port 8787) │
 │  Tizen app   │ ◀────────────────────────── │                                         │
 └──────────────┘                             │  catalog  ── HTTPS ──▶ site's JSON API  │
                                              │  headless Firefox + adblock ─▶ embeds   │
                                              │  HLS / image proxy (signed URLs)        │
                                              │  SQLite watch history                   │
                                              └─────────────────────────────────────────┘
```

A TV can't run Firefox, so the app has two parts:

| Part | What it does |
| --- | --- |
| `tizen-app/` | The TV app: HTML/CSS/JS for Tizen 5.0's Chromium 63 engine. It talks only to the backend. |
| `backend/` | A Python service (FastAPI + Playwright Firefox) that runs on any always-on machine on your network. |

**Mirror changes:** the site is a Next.js front end on top of a JSON API. When the domain changes TLD, the backend tries the known mirrors in `config.py` plus any you add under **Settings → Site mirrors**. It reads the site's JS bundle and pulls the current API address out of it, so following a mirror change means typing one domain.

**Streams:** episode players are third-party embeds full of obfuscated JS, ads and pop-unders. The backend opens the embed in a **locked-down headless Firefox**, lets the player request its HLS manifest, records that URL and closes the browser context. The video is then proxied to the TV.

## Safety and privacy

- **Only whitelisted data reaches the TV:** titles, artwork, synopsis, genres, basic facts and episode numbers. Comments, user data and tracking fields are dropped. Episode embed links never leave the backend.
- **The TV never contacts the site, the embeds or the video hosts.** Images, playlists, segments and subtitles all go through the backend.
- **The proxy is not open:** every proxied URL carries an HMAC signature that the backend issued itself. Anything else gets a 403.
- **The headless Firefox is locked down:**
  - It gets a fresh in-memory context per episode, with no profile, cookies or cache kept.
  - Every request is checked against uBlock Origin's filter syntax (Brave's `adblock-rust` engine) with uBO filters, badware, privacy, unbreak, EasyList, EasyPrivacy and Peter Lowe's list, refreshed daily.
  - Images and fonts aren't loaded at all.
  - `window.open` is disabled, and any pop-up or new tab is closed immediately.
  - The page can't navigate away from the embed host (blocks redirect hijacks).
  - WebRTC, geolocation, notifications, push, service workers, beacons and downloads are off.
  - Only embed hosts listed in `HIANIME_EMBED_HOSTS` are ever opened.
- **Watch history stays local** in `backend/data/history.db` and is never sent upstream.

## Setup

### 1. Backend (Linux PC or Raspberry Pi on the same network as the TV)

```bash
./scripts/setup-backend.sh     # venv, dependencies, Playwright Firefox
./scripts/run-backend.sh       # prints the address to enter on the TV
```

The script uses `uv` if it's installed, otherwise `python3 -m venv` (on Debian/Ubuntu that needs `sudo apt install python3-venv`). On a fresh machine you may also need Firefox's system libraries: `sudo .venv/bin/python -m playwright install-deps firefox`.

To try the whole UI in a desktop browser, open <http://localhost:8787/app/>. Use the arrow keys, Enter and Esc as the remote. In the browser, playback uses `<video>` + hls.js instead of AVPlay.

To keep it running after reboots, edit and install `backend/hianime-backend.service` (instructions are inside the file).

### 2. TV app (UN55RU7100)

1. **Turn on Developer Mode on the TV.** Open **Apps**, press `1 2 3 4 5` on the remote, switch Developer Mode **On**, enter your PC's IP address, then restart the TV.
2. **Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)** with the *TV Extensions* and *Samsung Certificate Extension* packages.
3. **Create a Samsung certificate profile** in Tizen Studio's Certificate Manager (TV → Samsung). Add your TV's DUID by connecting to the TV once in Device Manager. Name the profile `HiAnime`, or set `TIZEN_PROFILE`.
4. **Build and install:**
   ```bash
   export PATH="$PATH:$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools"
   ./scripts/build-wgt.sh 192.168.1.40      # your TV's IP
   ```
5. **Open HiAnime from Apps.** On first launch it opens **Settings**. Enter the backend address (for example `192.168.1.50:8787`) and press **Save & test**.

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
| Player | RED / GREEN / YELLOW | Switch SUB↔DUB / turn subtitles on or off / try the next server |
| Player | Back | Hide the controls, then exit the player |

An episode counts as **watched** once you pass 90% of it.

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `HIANIME_PORT` | `8787` | Backend port |
| `HIANIME_HOST` | `0.0.0.0` | Bind address. Use the LAN IP to avoid exposing it on other interfaces. |
| `HIANIME_EMBED_HOSTS` | `zokoanime.video,megaplay.buzz,megaplay-1.buzz` | The only player hosts the headless browser may open |
| `HIANIME_STREAM_CACHE` | `900` | Seconds an extracted stream URL is reused |
| `HIANIME_EXTRACT_TIMEOUT` | `30` | Seconds to wait for a player to produce a stream |
| `HIANIME_DATA_DIR` | `backend/data` | History DB, filter lists, image cache, signing key |

If the site starts using a new player host, episodes fail with "Embed host not allowed". Add that host to `HIANIME_EMBED_HOSTS`.

## Project layout

```
backend/hianime_backend/
  config.py          settings, mirror list, signing key
  domains.py         mirror discovery (finds the API base in the site's JS bundle)
  catalog.py         catalog API client + field whitelist, categories
  adblock_engine.py  uBlock Origin / EasyList filtering
  browser.py         locked-down headless Firefox stream extractor
  hls_proxy.py       playlist rewriting, segment streaming, VTT → cues
  history.py         SQLite watch progress + genre weights for recommendations
  server.py          HTTP API used by the TV
tizen-app/
  config.xml         Tizen 5.0 TV manifest
  index.html, css/style.css
  js/nav.js          spatial navigation for the remote
  js/player.js       AVPlay engine (TV) / hls.js engine (desktop), OSD, subtitles
  js/views.js        Home, Details, Search, Categories, Watched, Settings
scripts/             setup, run, build/install, icon generator
```

## Disclaimer

This project is a client for a third-party website and doesn't host or distribute any media. You're responsible for making sure that what you stream is legal where you live.
