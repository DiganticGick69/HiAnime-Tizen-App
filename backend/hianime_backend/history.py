"""Local watch history (SQLite). Nothing here is ever sent upstream."""
import json
import sqlite3
import threading
import time

from . import config

WATCHED_RATIO = 0.9  # an episode counts as watched past 90%

_SCHEMA = """
CREATE TABLE IF NOT EXISTS anime (
    slug TEXT PRIMARY KEY,
    meta TEXT NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
    slug TEXT NOT NULL,
    episode INTEGER NOT NULL,
    lang TEXT NOT NULL,
    position REAL NOT NULL,
    duration REAL NOT NULL,
    watched INTEGER NOT NULL DEFAULT 0,
    updated REAL NOT NULL,
    PRIMARY KEY (slug, episode)
);
CREATE INDEX IF NOT EXISTS progress_updated ON progress(updated DESC);
"""


class History:
    def __init__(self) -> None:
        self._db = sqlite3.connect(config.DATA_DIR / "history.db", check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        self._lock = threading.Lock()

    def remember_anime(self, anime: dict) -> None:
        meta = {k: anime.get(k) for k in ("slug", "title", "image", "banner", "genres", "type", "episodes", "sub", "dub")}
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO anime(slug, meta, updated) VALUES(?,?,?) "
                "ON CONFLICT(slug) DO UPDATE SET meta=excluded.meta, updated=excluded.updated",
                (anime["slug"], json.dumps(meta), time.time()),
            )

    def save_progress(self, slug: str, episode: int, lang: str, position: float, duration: float) -> dict:
        watched = 1 if duration > 0 and position / duration >= WATCHED_RATIO else 0
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO progress(slug, episode, lang, position, duration, watched, updated) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(slug, episode) DO UPDATE SET "
                "lang=excluded.lang, position=excluded.position, duration=excluded.duration, "
                "watched=MAX(progress.watched, excluded.watched), updated=excluded.updated",
                (slug, episode, lang, position, duration, watched, time.time()),
            )
        return {"watched": bool(watched)}

    def set_watched(self, slug: str, episode: int, watched: bool) -> None:
        with self._lock, self._db:
            if watched:
                self._db.execute(
                    "INSERT INTO progress(slug, episode, lang, position, duration, watched, updated) "
                    "VALUES(?,?,'sub',0,0,1,?) ON CONFLICT(slug, episode) DO UPDATE SET watched=1",
                    (slug, episode, time.time()),
                )
            else:
                self._db.execute("DELETE FROM progress WHERE slug=? AND episode=?", (slug, episode))

    def anime_progress(self, slug: str) -> dict:
        rows = self._db.execute(
            "SELECT episode, lang, position, duration, watched, updated FROM progress WHERE slug=?", (slug,)
        ).fetchall()
        eps = {
            str(r["episode"]): {
                "position": r["position"], "duration": r["duration"],
                "watched": bool(r["watched"]), "lang": r["lang"],
            }
            for r in rows
        }
        last = max(rows, key=lambda r: r["updated"], default=None)
        return {
            "episodes": eps,
            "last": {"episode": last["episode"], "lang": last["lang"], "position": last["position"]} if last else None,
        }

    def continue_watching(self, limit: int = 40) -> list[dict]:
        rows = self._db.execute(
            """
            SELECT p.slug, p.episode, p.lang, p.position, p.duration, p.watched, p.updated, a.meta,
                   (SELECT COUNT(*) FROM progress w WHERE w.slug = p.slug AND w.watched = 1) AS watched_count
            FROM progress p JOIN anime a ON a.slug = p.slug
            WHERE p.updated = (SELECT MAX(updated) FROM progress q WHERE q.slug = p.slug)
            ORDER BY p.updated DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        out = []
        for r in rows:
            meta = json.loads(r["meta"])
            meta["resume"] = {
                "episode": r["episode"], "lang": r["lang"], "position": r["position"],
                "duration": r["duration"], "watched": bool(r["watched"]),
            }
            meta["watchedCount"] = r["watched_count"]
            meta["lastWatched"] = r["updated"]
            out.append(meta)
        return out

    def watched_slugs(self) -> set[str]:
        return {r[0] for r in self._db.execute("SELECT DISTINCT slug FROM progress")}

    def genre_weights(self) -> dict[str, float]:
        """Genres weighted by episodes watched, decaying with age (30-day half-life)."""
        now = time.time()
        rows = self._db.execute(
            "SELECT a.meta, COUNT(p.episode) AS n, MAX(p.updated) AS last "
            "FROM progress p JOIN anime a ON a.slug = p.slug GROUP BY p.slug"
        ).fetchall()
        weights: dict[str, float] = {}
        for r in rows:
            decay = 0.5 ** ((now - r["last"]) / (30 * 86400))
            for g in json.loads(r["meta"]).get("genres") or []:
                weights[g] = weights.get(g, 0) + (1 + r["n"] ** 0.5) * decay
        return weights

    def remove_anime(self, slug: str) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM progress WHERE slug=?", (slug,))


history = History()
