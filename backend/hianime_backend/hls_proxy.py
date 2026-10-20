"""HLS + subtitle proxy.

Stream hosts reject requests without the embed's Referer, and we don't want the
TV talking to those hosts anyway. Playlists are fetched here, every URI inside
them is rewritten to a signed backend URL, and segments are streamed through.
"""
import re
from urllib.parse import urljoin

import httpx

from . import config
from .security import hls_url

_URI_ATTR = re.compile(r'URI="([^"]+)"')

client = httpx.AsyncClient(
    headers={"User-Agent": config.USER_AGENT},
    timeout=httpx.Timeout(20, connect=8),
    follow_redirects=True,
    limits=httpx.Limits(max_connections=32, max_keepalive_connections=16),
)


def upstream_headers(referer: str) -> dict:
    origin = referer.rstrip("/")
    if origin.count("/") > 2:
        origin = "/".join(origin.split("/")[:3])
    return {"Referer": referer, "Origin": origin}


def rewrite_playlist(text: str, base_url: str, referer: str) -> str:
    out = []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            out.append(line)
            continue
        if s.startswith("#"):
            # Keys, media renditions, I-frame playlists, maps: rewrite URI="..."
            def repl(m: re.Match) -> str:
                absu = urljoin(base_url, m.group(1))
                kind = "pl" if s.startswith(("#EXT-X-MEDIA", "#EXT-X-I-FRAME")) else "seg"
                return f'URI="{hls_url(absu, referer, kind)}"'
            out.append(_URI_ATTR.sub(repl, line))
            continue
        absu = urljoin(base_url, s)
        prev = lines[i - 1].strip() if i else ""
        is_playlist = prev.startswith("#EXT-X-STREAM-INF") or absu.split("?")[0].endswith(".m3u8")
        out.append(hls_url(absu, referer, "pl" if is_playlist else "seg"))
    return "\n".join(out) + "\n"


async def fetch_playlist(url: str, referer: str) -> str:
    r = await client.get(url, headers=upstream_headers(referer))
    r.raise_for_status()
    return rewrite_playlist(r.text, str(r.url), referer)


async def fetch_vtt_cues(url: str, referer: str) -> list[dict]:
    r = await client.get(url, headers=upstream_headers(referer))
    r.raise_for_status()
    return parse_vtt(r.text)


_TS = re.compile(r"(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})")
_TAGS = re.compile(r"<[^>]+>")


def _secs(ts: str) -> float:
    m = _TS.search(ts)
    if not m:
        return 0.0
    h, mnt, s, ms = m.groups()
    return int(h or 0) * 3600 + int(mnt) * 60 + int(s) + int(ms) / 1000


def parse_vtt(text: str) -> list[dict]:
    """Return [{start, end, text}] with markup stripped, for the TV's overlay."""
    cues = []
    for block in re.split(r"\r?\n\r?\n", text.replace("﻿", "")):
        lines = [l for l in block.strip().splitlines() if l.strip()]
        for i, l in enumerate(lines):
            if "-->" in l:
                start, end = l.split("-->", 1)
                body = "\n".join(_TAGS.sub("", x) for x in lines[i + 1:]).strip()
                if body:
                    cues.append({"start": round(_secs(start), 3), "end": round(_secs(end), 3), "text": body})
                break
    return cues
