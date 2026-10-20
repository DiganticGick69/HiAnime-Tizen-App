"""Runtime settings. Everything can be overridden with environment variables."""
import json
import os
import secrets
from pathlib import Path

DATA_DIR = Path(os.environ.get("HIANIME_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

HOST = os.environ.get("HIANIME_HOST", "0.0.0.0")
PORT = int(os.environ.get("HIANIME_PORT", "8787"))

# Front-end mirrors of the site. When one is taken down the site usually reappears
# under a new TLD, so we keep a list and probe them in order. Users can add more
# from the TV settings screen (persisted in data/domains.json).
DEFAULT_SITE_DOMAINS = [
    "hianimes.se",
    "hianime.at",
    "hianimes.to",
    "hianime.to",
    "hianime.sx",
    "hianime.nz",
    "hianime.bz",
    "hianime.pe",
    "hianime.cx",
]

# API bases seen in the site bundle. Used as a fallback if no mirror answers.
DEFAULT_API_BASES = ["https://animehot.cc/api", "https://anitv.cfd/api"]

# Only embed hosts on this list are ever opened in the headless browser.
# The list comes from the episode links the API returns; extend it if the site
# adds a new player host.
EMBED_HOSTS = [
    h.strip() for h in os.environ.get(
        "HIANIME_EMBED_HOSTS", "zokoanime.video,megaplay.buzz,megaplay-1.buzz"
    ).split(",") if h.strip()
]

USER_AGENT = os.environ.get(
    "HIANIME_UA", "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
)

STREAM_CACHE_SECONDS = int(os.environ.get("HIANIME_STREAM_CACHE", "900"))
EXTRACT_TIMEOUT_SECONDS = int(os.environ.get("HIANIME_EXTRACT_TIMEOUT", "30"))
FILTER_REFRESH_HOURS = int(os.environ.get("HIANIME_FILTER_REFRESH_HOURS", "24"))

# The secret signs proxy URLs so the backend can't be used as an open proxy.
_secret_file = DATA_DIR / "secret.key"
if not _secret_file.exists():
    _secret_file.write_text(secrets.token_hex(32))
SECRET = _secret_file.read_text().strip().encode()

_domains_file = DATA_DIR / "domains.json"


def load_user_domains() -> list[str]:
    try:
        return [d for d in json.loads(_domains_file.read_text()) if isinstance(d, str)]
    except (OSError, ValueError):
        return []


def save_user_domains(domains: list[str]) -> None:
    _domains_file.write_text(json.dumps(domains, indent=2))
