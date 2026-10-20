"""HTTP API used by the TV app.

Run with:  python -m hianime_backend
"""
import asyncio
import hashlib
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, hls_proxy, security
from .adblock_engine import blocker
from .browser import StreamInfo, extractor, host_allowed
from .catalog import CATEGORIES, catalog
from .domains import resolver
from .history import history

log = logging.getLogger("hianime")

IMG_CACHE = config.DATA_DIR / "img-cache"
IMG_CACHE.mkdir(exist_ok=True)
TV_APP_DIR = Path(__file__).resolve().parents[2] / "tizen-app"

_streams: dict[tuple, StreamInfo] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(blocker.load)
    cutoff = time.time() - 14 * 86400
    for p in IMG_CACHE.iterdir():
        if p.stat().st_mtime < cutoff:
            p.unlink(missing_ok=True)
    try:
        await resolver.resolve()
    except RuntimeError as e:
        log.error("%s", e)
    yield
    await extractor.close()
    await catalog.close()
    await hls_proxy.client.aclose()


app = FastAPI(title="HiAnime TV backend", lifespan=lifespan)
# The Tizen app runs from its own widget origin, so it needs CORS. No cookies
# or credentials are used anywhere, so a wildcard origin is safe.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "DELETE"],
                   allow_headers=["Content-Type"])


@app.exception_handler(RuntimeError)
async def upstream_down(_: Request, exc: RuntimeError) -> JSONResponse:
    return JSONResponse({"error": str(exc)}, status_code=503)


# ---------------------------------------------------------------- catalog

@app.get("/api/status")
async def status() -> dict:
    return {"ok": True, "site": resolver.site, "api": resolver.api,
            "domains": resolver.candidates(), "filtersLoadedAt": blocker.loaded_at}


@app.get("/api/home")
async def home() -> dict:
    data = await catalog.home()
    data["continue"] = history.continue_watching(20)
    data["recommended"] = await _recommendations(24)
    data["categories"] = [{"id": c["id"], "name": c["name"]} for c in CATEGORIES]
    return data


@app.get("/api/categories")
async def categories() -> list[dict]:
    return [{"id": c["id"], "name": c["name"]} for c in CATEGORIES]


@app.get("/api/category/{cat_id}")
async def category(cat_id: str, page: int = Query(1, ge=1, le=500)) -> dict:
    return await catalog.category(cat_id, page)


@app.get("/api/search")
async def search(q: str = Query(..., min_length=1, max_length=80)) -> dict:
    results = await catalog.search(q)
    if len(results) < 6:
        extra = await catalog.filter(keyword=q, limit=24)
        seen = {a["slug"] for a in results}
        results += [a for a in extra["results"] if a["slug"] not in seen]
    return {"results": results}


@app.get("/api/anime/{slug}")
async def anime(slug: str) -> dict:
    a = await catalog.detail(slug)
    if not a:
        raise HTTPException(404, "Anime not found")
    a["progress"] = history.anime_progress(slug)
    return a


@app.get("/api/watched")
async def watched() -> dict:
    return {"results": history.continue_watching(200)}


@app.delete("/api/watched/{slug}")
async def forget(slug: str) -> dict:
    history.remove_anime(slug)
    return {"ok": True}


@app.get("/api/recommended")
async def recommended() -> dict:
    return {"results": await _recommendations(48)}


async def _recommendations(limit: int) -> list[dict]:
    weights = history.genre_weights()
    seen = history.watched_slugs()
    if not weights:
        return (await catalog.filter(sort="Score", limit=limit))["results"]
    top = sorted(weights, key=weights.get, reverse=True)[:4]
    # Pairs of the user's favourite genres first (more specific), then singles.
    queries = [[top[0], g] for g in top[1:3]] + [[g] for g in top]
    pages = await asyncio.gather(*(catalog.filter(genre=g, sort="Score", limit=24) for g in queries),
                                 return_exceptions=True)
    out, used = [], set(seen)
    pools = [p["results"] for p in pages if not isinstance(p, BaseException)]
    # Round-robin so one genre doesn't dominate the row.
    while len(out) < limit and any(pools):
        for pool in pools:
            while pool:
                a = pool.pop(0)
                if a["slug"] not in used:
                    used.add(a["slug"])
                    out.append(a)
                    break
    return out[:limit]


# ---------------------------------------------------------------- playback

class ProgressIn(BaseModel):
    slug: str = Field(max_length=300)
    episode: int = Field(ge=0, le=100000)
    lang: str = Field(pattern="^(sub|dub)$")
    position: float = Field(ge=0)
    duration: float = Field(ge=0)


class WatchedIn(BaseModel):
    slug: str = Field(max_length=300)
    episode: int = Field(ge=0, le=100000)
    watched: bool


@app.post("/api/progress")
async def progress(p: ProgressIn) -> dict:
    a = await catalog.detail(p.slug)
    if a:
        history.remember_anime(a)
    return history.save_progress(p.slug, p.episode, p.lang, p.position, p.duration)


@app.post("/api/watched")
async def mark_watched(w: WatchedIn) -> dict:
    a = await catalog.detail(w.slug)
    if a:
        history.remember_anime(a)
    history.set_watched(w.slug, w.episode, w.watched)
    return {"ok": True}


@app.get("/api/stream")
async def stream(slug: str, ep: int, lang: str = Query("sub", pattern="^(sub|dub)$"),
                 server: int = Query(0, ge=0, le=9)) -> dict:
    links = [l for l in await catalog.embed_links(slug, ep, lang) if host_allowed(l)]
    if not links:
        raise HTTPException(404, f"No {lang} source for episode {ep}")
    site_ref = f"https://{resolver.site or config.DEFAULT_SITE_DOMAINS[0]}/"
    order = list(range(len(links)))
    order = order[server % len(links):] + order[:server % len(links)]
    errors = []
    for idx in order:
        key = (slug, ep, lang, idx)
        info = _streams.get(key)
        if info and time.time() - info.created < config.STREAM_CACHE_SECONDS:
            return _stream_payload(info, idx, len(links))
        try:
            info = await extractor.extract(links[idx], site_ref)
        except Exception as e:  # noqa: BLE001 - try the next server
            log.warning("Server %d failed for %s ep %s: %s", idx, slug, ep, e)
            errors.append(str(e))
            continue
        _streams[key] = info
        return _stream_payload(info, idx, len(links))
    raise HTTPException(502, "All servers failed: " + "; ".join(errors))


def _stream_payload(info: StreamInfo, idx: int, total: int) -> dict:
    subs = [{"label": s["label"],
             "url": f"/subs?u={security.encode(s['url'])}&r={security.encode(info.referer)}"
                    f"&s={security.sign('sub', s['url'], info.referer)}"}
            for s in info.subtitles]
    return {"url": security.hls_url(info.master, info.referer, "pl"), "subtitles": subs,
            "server": idx, "servers": total, "adsBlocked": info.blocked}


def _verified(kind: str, u: str, r: str, s: str) -> tuple[str, str]:
    try:
        url, ref = security.decode(u), security.decode(r)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Bad URL")
    if not security.verify(s, kind, url, ref):
        raise HTTPException(403, "Bad signature")
    return url, ref


@app.get("/hls/pl")
async def hls_playlist(u: str, r: str, s: str) -> Response:
    url, ref = _verified("pl", u, r, s)
    try:
        body = await hls_proxy.fetch_playlist(url, ref)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Upstream playlist failed: {e}")
    return Response(body, media_type="application/vnd.apple.mpegurl",
                    headers={"Cache-Control": "no-cache"})


@app.get("/hls/seg")
async def hls_segment(u: str, r: str, s: str, request: Request) -> StreamingResponse:
    url, ref = _verified("seg", u, r, s)
    headers = hls_proxy.upstream_headers(ref)
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
    req = hls_proxy.client.build_request("GET", url, headers=headers)
    upstream = await hls_proxy.client.send(req, stream=True)
    if upstream.status_code >= 400:
        await upstream.aclose()
        raise HTTPException(502, f"Upstream segment {upstream.status_code}")
    passthru = {k: v for k, v in upstream.headers.items()
                if k.lower() in ("content-length", "content-range", "accept-ranges")}
    ctype = upstream.headers.get("content-type", "video/mp2t")
    # Some hosts disguise TS segments as images; AVPlay wants a video type.
    if ctype.startswith(("image/", "text/")):
        ctype = "video/mp2t"

    async def body():
        try:
            async for chunk in upstream.aiter_raw(64 * 1024):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(body(), status_code=upstream.status_code, media_type=ctype, headers=passthru)


@app.get("/subs")
async def subtitles(u: str, r: str, s: str) -> dict:
    url, ref = _verified("sub", u, r, s)
    try:
        return {"cues": await hls_proxy.fetch_vtt_cues(url, ref)}
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Upstream subtitles failed: {e}")


# ---------------------------------------------------------------- images

@app.get("/img")
async def image(u: str, s: str) -> Response:
    try:
        url = security.decode(u)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Bad URL")
    if not security.verify(s, "img", url):
        raise HTTPException(403, "Bad signature")
    key = hashlib.sha1(url.encode()).hexdigest()
    path = IMG_CACHE / key
    ctype_path = IMG_CACHE / (key + ".type")
    if path.exists():
        ctype = ctype_path.read_text() if ctype_path.exists() else "image/jpeg"
        return Response(path.read_bytes(), media_type=ctype, headers={"Cache-Control": "max-age=604800"})
    try:
        resp = await hls_proxy.client.get(url, headers={"Accept": "image/*"})
        resp.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(502, "Image unavailable")
    ctype = resp.headers.get("content-type", "image/jpeg").split(";")[0]
    if not ctype.startswith("image/"):
        raise HTTPException(502, "Not an image")
    path.write_bytes(resp.content)
    ctype_path.write_text(ctype)
    return Response(resp.content, media_type=ctype, headers={"Cache-Control": "max-age=604800"})


# ---------------------------------------------------------------- settings

class DomainsIn(BaseModel):
    domains: list[str] = Field(max_length=30)


@app.post("/api/settings/domains")
async def set_domains(d: DomainsIn) -> dict:
    clean = []
    for x in d.domains:
        x = x.strip().lower().removeprefix("https://").removeprefix("http://").strip("/")
        if x and len(x) < 100 and "." in x and " " not in x:
            clean.append(x)
    config.save_user_domains(clean)
    await resolver.resolve(force=True)
    return await status()


@app.post("/api/settings/refresh-filters")
async def refresh_filters() -> dict:
    await asyncio.to_thread(blocker.load, True)
    return {"ok": True, "filtersLoadedAt": blocker.loaded_at}


# ---------------------------------------------------------------- dev preview

if TV_APP_DIR.exists():
    app.mount("/app", StaticFiles(directory=TV_APP_DIR, html=True), name="tv-app")

    @app.get("/")
    async def root() -> RedirectResponse:
        return RedirectResponse("/app/")
