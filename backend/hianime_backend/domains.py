"""Find a working mirror of the site and the JSON API it talks to.

The site is a Next.js app; its JS bundle embeds the API base URL(s). When the
front-end domain changes TLD, we probe the known mirrors, read the bundle, and
pull the API base out of it, so the backend follows the site automatically.
"""
import asyncio
import logging
import re
import time

import httpx

from . import config

log = logging.getLogger(__name__)

_CHUNK_RE = re.compile(r'/_next/static/chunks/[A-Za-z0-9_.~-]+\.js')
_API_RE = re.compile(r'https://[A-Za-z0-9.-]+\.[a-z]{2,}/api(?=["`,])')


class DomainResolver:
    def __init__(self) -> None:
        self.site: str | None = None
        self.api: str | None = None
        self._checked_at = 0.0
        self._lock = asyncio.Lock()

    def candidates(self) -> list[str]:
        seen, out = set(), []
        for d in config.load_user_domains() + config.DEFAULT_SITE_DOMAINS:
            d = d.strip().lower().removeprefix("https://").removeprefix("http://").strip("/")
            if d and d not in seen:
                seen.add(d)
                out.append(d)
        return out

    async def _api_works(self, client: httpx.AsyncClient, base: str) -> bool:
        try:
            r = await client.get(f"{base}/anime/trending", timeout=8)
            return r.status_code == 200 and "animes" in r.json()
        except (httpx.HTTPError, ValueError):
            return False

    async def _apis_from_site(self, client: httpx.AsyncClient, domain: str) -> list[str]:
        r = await client.get(f"https://{domain}/home", timeout=10)
        if r.status_code != 200 or "/_next/" not in r.text:
            return []
        found: list[str] = []
        for chunk in dict.fromkeys(_CHUNK_RE.findall(r.text)):
            try:
                js = (await client.get(f"https://{domain}{chunk}", timeout=10)).text
            except httpx.HTTPError:
                continue
            for api in _API_RE.findall(js):
                if api not in found:
                    found.append(api)
            if found:
                break
        return found

    async def resolve(self, force: bool = False) -> str:
        """Return a working API base, probing mirrors if needed."""
        async with self._lock:
            if self.api and not force and time.time() - self._checked_at < 3600:
                return self.api
            headers = {"User-Agent": config.USER_AGENT}
            async with httpx.AsyncClient(headers=headers, follow_redirects=True) as client:
                for domain in self.candidates():
                    try:
                        apis = await self._apis_from_site(client, domain)
                    except httpx.HTTPError:
                        continue
                    for api in apis:
                        if await self._api_works(client, api):
                            self.site, self.api = domain, api
                            self._checked_at = time.time()
                            log.info("Using mirror %s with API %s", domain, api)
                            return api
                for api in config.DEFAULT_API_BASES:
                    if await self._api_works(client, api):
                        self.api = api
                        self._checked_at = time.time()
                        log.warning("No mirror answered; falling back to API %s", api)
                        return api
            raise RuntimeError("No working mirror found. Add the current domain in Settings.")


resolver = DomainResolver()
