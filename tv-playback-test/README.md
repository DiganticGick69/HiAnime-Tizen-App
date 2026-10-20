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
