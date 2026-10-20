"""uBlock Origin-style network filtering for the headless browser.

Uses Brave's adblock-rust engine (the `adblock` package), which parses the same
filter syntax as uBlock Origin. We load uBO's own lists plus EasyList /
EasyPrivacy / Peter Lowe's list and refresh them daily.
"""
import logging
import time
from hashlib import sha1

import adblock
import httpx

from . import config

log = logging.getLogger(__name__)

FILTER_LISTS = [
    "https://ublockorigin.github.io/uAssets/filters/filters.txt",
    "https://ublockorigin.github.io/uAssets/filters/badware.txt",
    "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
    "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
    "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist.to/easylist/easyprivacy.txt",
    "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
]

# Extra rules for things the public lists miss on these embeds: pop-under
# networks, players' analytics pings, and push-notification prompts.
EXTRA_RULES = """
||jwpltx.com^
||statlytic.net^
||plausible.io^
||connatix.com^
||cloudflareinsights.com^
||googletagmanager.com^
||google-analytics.com^
||doubleclick.net^
||onesignal.com^
||pushnotifications.click^
/mt/3p.js
"""

_RESOURCE_TYPES = {
    "document": "document", "stylesheet": "stylesheet", "image": "image", "media": "media",
    "font": "font", "script": "script", "xhr": "xmlhttprequest", "fetch": "xmlhttprequest",
    "websocket": "websocket", "texttrack": "media", "eventsource": "xmlhttprequest",
}

_FILTER_DIR = config.DATA_DIR / "filters"


class AdBlocker:
    def __init__(self) -> None:
        self.engine: adblock.Engine | None = None
        self.loaded_at = 0.0

    def _download(self) -> None:
        _FILTER_DIR.mkdir(exist_ok=True)
        with httpx.Client(timeout=30, follow_redirects=True,
                          headers={"User-Agent": config.USER_AGENT}) as client:
            for url in FILTER_LISTS:
                path = _FILTER_DIR / (sha1(url.encode()).hexdigest()[:12] + ".txt")
                try:
                    r = client.get(url)
                    r.raise_for_status()
                    path.write_text(r.text)
                except httpx.HTTPError as e:
                    log.warning("Could not refresh filter list %s: %s", url, e)

    def load(self, refresh: bool = False) -> None:
        stale = not any(_FILTER_DIR.glob("*.txt")) or (
            time.time() - min((p.stat().st_mtime for p in _FILTER_DIR.glob("*.txt")), default=0)
            > config.FILTER_REFRESH_HOURS * 3600
        )
        if refresh or stale:
            self._download()
        fs = adblock.FilterSet()
        count = 0
        for path in _FILTER_DIR.glob("*.txt"):
            fs.add_filter_list(path.read_text(errors="ignore"))
            count += 1
        fs.add_filter_list(EXTRA_RULES)
        self.engine = adblock.Engine(fs)
        self.loaded_at = time.time()
        log.info("Ad blocker loaded %d filter lists", count)

    def maybe_refresh(self) -> None:
        if time.time() - self.loaded_at > config.FILTER_REFRESH_HOURS * 3600:
            self.load(refresh=True)

    def should_block(self, url: str, source_url: str, resource_type: str) -> bool:
        if self.engine is None:
            self.load()
        res = self.engine.check_network_urls(
            url, source_url or url, _RESOURCE_TYPES.get(resource_type, "other")
        )
        return res.matched and not res.exception


blocker = AdBlocker()
