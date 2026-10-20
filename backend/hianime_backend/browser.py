"""Headless Firefox stream extractor.

Episode players are third-party embeds full of obfuscated JS, pop-unders and
trackers. Instead of reimplementing each player's decryption, we open the embed
in a locked-down headless Firefox, let its player request the HLS manifest, and
record that URL. The browser never shows anything to the user; it only exists
to discover the manifest.

Safety measures:
  * fresh, in-memory browser context per episode (no profile, cookies or cache kept)
  * every request is checked against uBlock Origin / EasyList filters
  * images, fonts and other non-essential resources are not loaded at all
  * window.open is disabled and any popup/new tab is closed immediately
  * the top-level page may not navigate away from the embed host
  * WebRTC, geolocation, notifications, push, service workers and downloads are off
  * only hosts in config.EMBED_HOSTS are ever opened
"""
import asyncio
import logging
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from playwright.async_api import Browser, Page, Playwright, Request, Route, async_playwright

from . import config
from .adblock_engine import blocker

log = logging.getLogger(__name__)

FIREFOX_PREFS = {
    "dom.disable_open_during_load": True,
    "dom.popup_maximum": 0,
    "browser.link.open_newwindow": 1,
    "browser.link.open_newwindow.restriction": 0,
    "media.peerconnection.enabled": False,
    "geo.enabled": False,
    "dom.webnotifications.enabled": False,
    "dom.push.enabled": False,
    "dom.serviceWorkers.enabled": False,
    "network.prefetch-next": False,
    "network.dns.disablePrefetch": True,
    "network.http.speculative-parallel-limit": 0,
    "privacy.trackingprotection.enabled": True,
    "privacy.resistFingerprinting": False,
    "beacon.enabled": False,
    "browser.send_pings": False,
    "media.autoplay.default": 0,
    "media.autoplay.blocking_policy": 0,
    "media.volume_scale": "0.0",
    "toolkit.telemetry.enabled": False,
    "datareporting.healthreport.uploadEnabled": False,
}

INIT_SCRIPT = """
(() => {
  const noop = () => null;
  try { Object.defineProperty(window, 'open', { value: noop, writable: false }); } catch (e) { window.open = noop; }
  try { Notification.requestPermission = () => Promise.resolve('denied'); } catch (e) {}
  // Neutralise "click anywhere" pop-under handlers that target new windows.
  document.addEventListener('click', (ev) => {
    const a = ev.target && ev.target.closest && ev.target.closest('a[target]');
    if (a) { ev.preventDefault(); ev.stopPropagation(); }
  }, true);
})();
"""

# Resource types the player never needs.
SKIP_TYPES = {"image", "font", "manifest", "other"}


@dataclass
class StreamInfo:
    master: str
    referer: str
    subtitles: list[dict] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    blocked: int = 0


def host_allowed(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in config.EMBED_HOSTS)


class StreamExtractor:
    def __init__(self) -> None:
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self._lock = asyncio.Lock()
        self._sem = asyncio.Semaphore(2)

    async def _ensure_browser(self) -> Browser:
        async with self._lock:
            if self._browser is None or not self._browser.is_connected():
                if self._pw is None:
                    self._pw = await async_playwright().start()
                self._browser = await self._pw.firefox.launch(
                    headless=True, firefox_user_prefs=FIREFOX_PREFS
                )
                log.info("Headless Firefox started")
            return self._browser

    async def close(self) -> None:
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def extract(self, embed_url: str, site_referer: str) -> StreamInfo:
        if not host_allowed(embed_url):
            raise ValueError(f"Embed host not allowed: {urlparse(embed_url).hostname}")
        blocker.maybe_refresh()
        async with self._sem:
            browser = await self._ensure_browser()
            ctx = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent=config.USER_AGENT,
                accept_downloads=False,
                permissions=[],
                java_script_enabled=True,
                service_workers="block",
            )
            try:
                return await self._run(ctx, embed_url, site_referer)
            finally:
                await ctx.close()

    async def _run(self, ctx, embed_url: str, site_referer: str) -> StreamInfo:
        embed_host = urlparse(embed_url).hostname
        page: Page | None = None
        master: list[tuple[str, str]] = []
        subs: list[str] = []
        blocked = 0

        async def route(r: Route) -> None:
            nonlocal blocked
            req = r.request
            url = req.url
            is_main_doc = req.resource_type == "document" and req.frame.parent_frame is None
            if is_main_doc and urlparse(url).hostname != embed_host:
                blocked += 1  # redirect hijack attempt
                return await r.abort()
            if req.resource_type in SKIP_TYPES and not _is_stream(url):
                return await r.abort()
            if not is_main_doc and blocker.should_block(url, req.frame.url or embed_url, req.resource_type):
                blocked += 1
                return await r.abort()
            await r.continue_()

        def on_request(req: Request) -> None:
            path = urlparse(req.url).path.lower()
            if path.endswith(".m3u8"):
                ref = req.headers.get("referer") or f"https://{embed_host}/"
                master.append((req.url, ref))
            elif path.endswith(".vtt") and "thumbnail" not in path:
                subs.append(req.url)

        def on_page(p: Page) -> None:
            if page is not None and p is not page:
                asyncio.ensure_future(p.close())

        await ctx.add_init_script(INIT_SCRIPT)
        await ctx.route("**/*", route)
        ctx.on("request", on_request)
        ctx.on("page", on_page)

        page = await ctx.new_page()
        await page.goto(embed_url, referer=site_referer, wait_until="domcontentloaded",
                        timeout=config.EXTRACT_TIMEOUT_SECONDS * 1000)

        deadline = time.time() + config.EXTRACT_TIMEOUT_SECONDS
        clicked_at = time.time()
        while not master and time.time() < deadline:
            await asyncio.sleep(0.4)
            # Some players wait for a click before loading the source.
            if time.time() - clicked_at > 3:
                clicked_at = time.time()
                try:
                    await page.mouse.click(640, 360)
                except Exception:  # page may be mid-navigation
                    pass
        if not master:
            raise TimeoutError("Player did not load a stream")
        # Subtitles are often requested right after the manifest.
        await asyncio.sleep(1.5)

        url, referer = master[0]
        tracks = []
        for i, s in enumerate(dict.fromkeys(subs)):
            tracks.append({"url": s, "label": _subtitle_label(s, i)})
        log.info("Extracted stream from %s (blocked %d requests)", embed_host, blocked)
        return StreamInfo(master=url, referer=referer, subtitles=tracks, blocked=blocked)


def _is_stream(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.endswith((".m3u8", ".vtt", ".ts", ".m4s", ".mp4", ".key"))


def _subtitle_label(url: str, i: int) -> str:
    name = urlparse(url).path.rsplit("/", 1)[-1].lower()
    for code, label in (("eng", "English"), ("en", "English"), ("por", "Português"),
                        ("pt", "Português"), ("spa", "Español"), ("es", "Español")):
        if name.startswith(code + ".") or name.startswith(code + "-") or name.startswith(code + "_"):
            return label
    return "English" if i == 0 else f"Subtitles {i + 1}"


extractor = StreamExtractor()
