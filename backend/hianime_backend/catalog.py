"""Read-only access to the site's catalog API.

Upstream records carry a lot of fields (comments, user data, migration status,
...). We whitelist only what the TV needs: titles, artwork, synopsis, genres,
basic facts and episode numbers. Episode embed links never leave the backend;
the TV asks for "episode N, sub/dub" and the backend looks the link up itself.
"""
import asyncio
import html
import logging
import re
import time
from typing import Any
from urllib.parse import quote

import httpx

from . import config
from .domains import resolver
from .security import image_url

log = logging.getLogger(__name__)

# Home-screen categories. "genre" uses the site's genre filter; the site has no
# Isekai genre, so that one is built from title keyword searches instead.
CATEGORIES: list[dict[str, Any]] = [
    {"id": "isekai", "name": "Isekai", "keywords": ["isekai", "another world", "reincarnated", "reincarnation", "summoned"]},
    {"id": "action", "name": "Action", "genre": ["Action"]},
    {"id": "fantasy", "name": "Fantasy", "genre": ["Fantasy"]},
    {"id": "romance", "name": "Romance", "genre": ["Romance"]},
    {"id": "comedy", "name": "Comedy", "genre": ["Comedy"]},
    {"id": "scifi", "name": "Sci-Fi", "genre": ["Sci-Fi"]},
    {"id": "sliceoflife", "name": "Slice of Life", "genre": ["Slice of Life"]},
    {"id": "sports", "name": "Sports", "genre": ["Sports"]},
    {"id": "mecha", "name": "Mecha", "genre": ["Mecha"]},
    {"id": "supernatural", "name": "Supernatural", "genre": ["Supernatural"]},
    {"id": "mystery", "name": "Mystery", "genre": ["Mystery"]},
    {"id": "psychological", "name": "Psychological", "genre": ["Psychological"]},
    {"id": "horror", "name": "Horror", "genre": ["Horror"]},
    {"id": "drama", "name": "Drama", "genre": ["Drama"]},
]
CATEGORY_BY_ID = {c["id"]: c for c in CATEGORIES}

_SCORE_RE = re.compile(r"^\d{1,2}(\.\d+)?$")
_TAG_RE = re.compile(r"<[^>]+>")

# Genres the TV never shows.
HIDDEN_GENRES = {"Hentai"}


class _TTLCache:
    def __init__(self, ttl: float) -> None:
        self.ttl = ttl
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any:
        hit = self._data.get(key)
        if hit and time.time() - hit[0] < self.ttl:
            return hit[1]
        return None

    def put(self, key: str, value: Any) -> None:
        if len(self._data) > 2000:
            self._data.clear()
        self._data[key] = (time.time(), value)


def _int(v: Any) -> int | None:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None


def _score(a: dict) -> str | None:
    # Upstream sometimes stores the age rating here; only keep real scores.
    for k in ("Score", "score"):
        v = str(a.get(k) or "").strip()
        if _SCORE_RE.match(v) and float(v) > 0:
            return v
    return None


def _text(s: Any) -> str:
    return html.unescape(_TAG_RE.sub("", s)).strip() if isinstance(s, str) else ""


def slim_anime(a: dict | None) -> dict | None:
    """Reduce an upstream anime record to the whitelisted fields."""
    if not a or not isinstance(a, dict):
        return None
    slug = a.get("slug") or (a.get("slugs") or [None])[0]
    if not slug:
        return None
    genres = [g for g in (a.get("genres") or []) if isinstance(g, str)]
    if HIDDEN_GENRES & set(genres):
        return None
    total = _int(a.get("totalEpisodes"))
    eps = a.get("episodes")
    return {
        "slug": slug,
        "title": _text(a.get("title") or a.get("English") or a.get("alternateTitle")) or "Untitled",
        "japanese": a.get("Japanese") or None,
        "image": image_url(a.get("image") or a.get("originalImage")),
        "banner": image_url(a.get("landScapeImage") or a.get("originalLandScapeImage") or a.get("image")),
        "synopsis": _text(a.get("synopsis")),
        "genres": genres,
        "type": a.get("Type") or None,
        "status": a.get("Status") or None,
        "aired": a.get("Aired") or None,
        "duration": a.get("Duration") if a.get("Duration") not in ("", "Unknown") else None,
        "score": _score(a),
        "episodes": total or (len(eps) if isinstance(eps, list) else None),
        "sub": _int(a.get("totalSubbed")),
        "dub": _int(a.get("totalDubbed")),
    }


def _slim_list(items: Any) -> list[dict]:
    out, seen = [], set()
    for a in items or []:
        s = slim_anime(a)
        if s and s["slug"] not in seen:
            seen.add(s["slug"])
            out.append(s)
    return out


class Catalog:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            headers={"User-Agent": config.USER_AGENT, "Accept": "application/json"},
            timeout=12,
            follow_redirects=True,
        )
        self._cache = _TTLCache(300)
        self._detail_cache = _TTLCache(1800)

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, **kw: Any) -> Any:
        for attempt in range(2):
            api = await resolver.resolve(force=attempt > 0)
            headers = {}
            if resolver.site:
                headers = {"Origin": f"https://{resolver.site}", "Referer": f"https://{resolver.site}/"}
            try:
                r = await self._client.request(method, api + path, headers=headers, **kw)
                if r.status_code == 404:
                    return None
                r.raise_for_status()
                return r.json()
            except (httpx.HTTPError, ValueError) as e:
                log.warning("API %s %s failed (%s); re-resolving mirror", method, path, e)
        raise RuntimeError("Catalog API unavailable")

    async def _cached(self, key: str, method: str, path: str, **kw: Any) -> Any:
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        data = await self._request(method, path, **kw)
        if data is not None:
            self._cache.put(key, data)
        return data

    # ---- public API -----------------------------------------------------

    async def home(self) -> dict:
        d = await self._cached("home", "GET", "/home") or {}
        sec = lambda k: (d.get(k) or {}).get("animes")  # noqa: E731
        latest_eps = []
        for e in (d.get("latestEpisodes") or {}).get("episodes") or []:
            a = slim_anime(e.get("anime_info"))
            if a:
                a["latestEpisode"] = e.get("episodeNumber")
                latest_eps.append(a)
        return {
            "featured": _slim_list(f.get("anime") for f in d.get("featured") or []),
            "trending": _slim_list(sec("trending")),
            "popular": _slim_list(sec("popular")),
            "airing": _slim_list(sec("currentlyAiring")),
            "latestEpisodes": latest_eps,
            "newest": _slim_list(sec("latestAnime")),
        }

    async def filter(self, *, genre: list[str] | None = None, keyword: str | None = None,
                     sort: str = "Popularity", page: int = 1, limit: int = 24,
                     status: str | None = None, type_: str | None = None) -> dict:
        body: dict[str, Any] = {"page": page, "limit": limit}
        if genre:
            body["genre"] = genre
        if keyword:
            body["keyword"] = keyword
        if sort and sort != "Default":
            body["sort"] = sort
        if status:
            body["status"] = status
        if type_:
            body["type"] = type_
        key = "filter:" + repr(sorted(body.items()))
        d = await self._cached(key, "POST", "/filter", json=body) or {}
        return {"results": _slim_list(d.get("results")), "page": d.get("page", page),
                "totalPages": d.get("totalPages", 1)}

    async def category(self, cat_id: str, page: int = 1) -> dict:
        cat = CATEGORY_BY_ID.get(cat_id)
        if not cat:
            return {"results": [], "page": 1, "totalPages": 1}
        if "genre" in cat:
            res = await self.filter(genre=cat["genre"], page=page)
        else:
            parts = await asyncio.gather(
                *(self.filter(keyword=k, page=page, limit=24) for k in cat["keywords"]),
                return_exceptions=True,
            )
            merged: list[dict] = []
            seen: set[str] = set()
            pages = 1
            for p in parts:
                if isinstance(p, BaseException):
                    continue
                pages = max(pages, p["totalPages"])
                for a in p["results"]:
                    if a["slug"] not in seen:
                        seen.add(a["slug"])
                        merged.append(a)
            res = {"results": merged, "page": page, "totalPages": pages}
        res["name"] = cat["name"]
        res["id"] = cat_id
        return res

    async def search(self, query: str) -> list[dict]:
        query = query.strip()[:80]
        if len(query) < 2:
            return []
        d = await self._cached("search:" + query.lower(), "POST", "/search", json={"title": query})
        return _slim_list(d if isinstance(d, list) else [])

    async def _raw_detail(self, slug: str) -> dict | None:
        hit = self._detail_cache.get(slug)
        if hit is not None:
            return hit
        d = await self._request("GET", "/anime/" + quote(slug, safe=""))
        a = (d or {}).get("anime")
        if not a:
            return None
        # The detail record only embeds the first episode; the full list
        # (1000+ for long series) comes from the episodes endpoint.
        if a.get("_id"):
            eps = await self._request("GET", "/episodes/" + quote(str(a["_id"]), safe=""),
                                      params={"start": 1, "end": 100000})
            if eps and isinstance(eps.get("episodes"), list) and eps["episodes"]:
                a["episodes"] = eps["episodes"]
        self._detail_cache.put(slug, a)
        return a

    async def detail(self, slug: str) -> dict | None:
        raw = await self._raw_detail(slug)
        a = slim_anime(raw)
        if not a:
            return None
        # Records carry several slugs; keep the one the TV asked for so history
        # and lookups always use the same key.
        a["slug"] = slug
        dub_count = a["dub"] or 0
        sub_count = a["sub"]
        episodes = []
        for e in raw.get("episodes") or []:
            if not isinstance(e, dict):
                continue
            n = e.get("episodeNumber")
            link = e.get("link") or {}
            episodes.append({
                "number": n,
                "title": _episode_title(e.get("title"), n),
                "hasSub": bool(link.get("sub")) and (sub_count is None or n <= sub_count),
                "hasDub": bool(link.get("dub")) and n <= dub_count,
            })
        episodes.sort(key=lambda e: e["number"] or 0)
        a["episodeList"] = episodes
        return a

    async def embed_links(self, slug: str, number: int, lang: str) -> list[str]:
        raw = await self._raw_detail(slug)
        for e in (raw or {}).get("episodes") or []:
            if isinstance(e, dict) and e.get("episodeNumber") == number:
                links = (e.get("link") or {}).get(lang) or []
                return [l for l in links if isinstance(l, str)]
        return []


def _episode_title(title: Any, n: Any) -> str:
    """Upstream titles look like '<Anime> Episode 3'; show just 'Episode 3'."""
    if isinstance(title, str) and "Episode" in title:
        return "Episode" + title.rsplit("Episode", 1)[1]
    return f"Episode {n}"


catalog = Catalog()
