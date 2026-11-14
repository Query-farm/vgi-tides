"""Exact public NOAA recordings or explicit official-live reads for notebook stories."""

from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ENVIRONMENT = ("TIDES_API_BASE_URL", "TIDES_METADATA_BASE_URL")


class TidesSource:
    """Verify recordings, scope source URLs, and audit exact loopback requests."""

    def __init__(self, mode: str, story: str) -> None:
        if mode not in {"replay", "live"} or story not in {"heights", "currents"}:
            raise ValueError("Choose replay/live and heights/currents explicitly")
        folder = Path(__file__).parent / ("recordings" if story == "heights" else "current_recordings")
        self.provenance = json.loads((folder / "provenance.json").read_text())
        self.mode = mode
        self.story = story
        self.run_utc = datetime.now(UTC).isoformat()
        self.requests: list[str] = []
        self.server = None
        self.closed = False
        routes = {}
        if story == "heights":
            captures = [{**v, "file": name + ".json"} for name, v in self.provenance.items()]
        else:
            captures = self.provenance["captures"]
        for capture in captures:
            body = (folder / capture["file"]).read_bytes()
            if hashlib.sha256(body).hexdigest() != capture["sha256"]:
                raise ValueError("NOAA recording checksum mismatch: " + capture["file"])
            parsed = urlsplit(capture["url"])
            key = (parsed.path, tuple(sorted((k, tuple(v)) for k, v in parse_qs(parsed.query).items())))
            if key in routes:
                raise ValueError("Duplicated recorded request")
            routes[key] = (capture["file"], body)
        self.previous = {key: os.environ.pop(key, None) for key in ENVIRONMENT}
        if mode == "live":
            return
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args) -> None:
                pass

            def do_GET(self) -> None:
                parsed = urlsplit(self.path)
                key = (parsed.path, tuple(sorted((k, tuple(v)) for k, v in parse_qs(parsed.query).items())))
                match = routes.get(key)
                if match is None:
                    body = b'{"error":"Request is outside this NOAA recording"}'
                else:
                    name, body = match
                    owner.requests.append(name)
                self.send_response(200 if match else 404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        base = f"http://127.0.0.1:{self.server.server_port}"
        os.environ.update(
            TIDES_API_BASE_URL=base + "/api/prod",
            TIDES_METADATA_BASE_URL=base + "/mdapi/prod/webapi",
        )

    def audit(self) -> str:
        """Require exactly one read of each expected recorded response."""
        if self.mode == "live":
            return "Live run: direct NOAA retrieval; no replay server was created."
        expected = (
            ["predictions.json", "water_level.json"]
            if self.story == "heights"
            else [x["file"] for x in self.provenance["captures"]]
        )
        if sorted(self.requests) != sorted(expected):
            raise AssertionError("Expected exactly one request for every recorded product")
        return f"Replay audit: exactly {len(expected)} bounded requests with unchanged NOAA response bytes."

    def close(self) -> None:
        """Close the local service and restore source settings; safe to call twice."""
        if self.closed:
            return
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.thread.join(timeout=5)
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.closed = True
