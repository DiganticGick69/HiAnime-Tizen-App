"""Signed URLs for the image and HLS proxies.

The TV only ever receives URLs that point at this backend. Each one carries an
HMAC of the upstream URL, so the proxy refuses anything it didn't hand out
itself and can't be abused as an open proxy on the LAN.
"""
import base64
import hashlib
import hmac
from urllib.parse import quote

from . import config


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign(*parts: str) -> str:
    msg = "\x00".join(parts).encode()
    return _b64(hmac.new(config.SECRET, msg, hashlib.sha256).digest()[:18])


def encode(value: str) -> str:
    return _b64(value.encode())


def decode(value: str) -> str:
    return _unb64(value).decode()


def verify(sig: str, *parts: str) -> bool:
    return hmac.compare_digest(sign(*parts), sig)


def image_url(upstream: str | None) -> str | None:
    if not upstream or not upstream.startswith(("http://", "https://")):
        return None
    return f"/img?u={encode(upstream)}&s={sign('img', upstream)}"


def hls_url(upstream: str, referer: str, kind: str) -> str:
    """kind is 'pl' for playlists (rewritten) or 'seg' for media bytes."""
    u, r = encode(upstream), encode(referer)
    return f"/hls/{kind}?u={u}&r={r}&s={sign(kind, upstream, referer)}"


def q(value: str) -> str:
    return quote(value, safe="")
