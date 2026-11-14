"""Serve unchanged NOAA recordings or configure direct live retrieval."""

import hashlib
import json
import math
import os
import threading
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import matplotlib.pyplot as plt
import seaborn as sns
from IPython.display import Markdown, display

ENVIRONMENT = ("TIDES_API_BASE_URL", "TIDES_METADATA_BASE_URL")


class ReplayHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        product = params.get("product", [""])[0]
        self.server.requests.append(product)
        expected = self.server.provenance.get(product, {}).get("parameters", {})
        valid = (
            parsed.path == "/datagetter"
            and product in self.server.documents
            and params == {k: [str(v)] for k, v in expected.items()}
        )
        body = self.server.documents[product] if valid else b'{"error":"unrecorded request"}'
        self.send_response(200 if valid else 404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def configure(mode, threshold):
    if mode not in ("replay", "live"):
        raise ValueError("DATA_MODE must be 'replay' or 'live'")
    if type(threshold) not in (float, int) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("RESIDUAL_THRESHOLD_M must be a finite number from 0 through 1 metre")
    previous = {key: os.environ.pop(key, None) for key in ENVIRONMENT}
    server = thread = None
    folder = Path(__file__).parent / "recordings"
    provenance = json.loads((folder / "provenance.json").read_text())
    if mode == "replay":
        documents = {name: (folder / f"{name}.json").read_bytes() for name in provenance}
        for name, body in documents.items():
            if hashlib.sha256(body).hexdigest() != provenance[name]["sha256"]:
                raise ValueError("Recording checksum mismatch: " + name)
        server = ThreadingHTTPServer(("127.0.0.1", 0), ReplayHandler)
        server.documents = documents
        server.provenance = provenance
        server.requests = []
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        os.environ.update(TIDES_API_BASE_URL=base, TIDES_METADATA_BASE_URL=base + "/unrecorded-metadata")
    return server, thread, previous, datetime.now(UTC).isoformat(), provenance


def audit(server):
    if server is not None:
        assert sorted(server.requests) == ["predictions", "water_level"], (
            "Expected one exact request for each product"
        )
        return "Replay audit: exactly one prediction and one observation request with recorded parameters."
    return "Live run: direct NOAA retrieval; no replay server was created."


def cleanup(server, thread, previous):
    if server:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    for key, value in previous.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value


def prose(text: str) -> None:
    display(Markdown(text))


def theme() -> None:
    sns.set_theme(
        style="whitegrid",
        rc={
            "figure.dpi": 145,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "grid.color": "#E8EDE9",
            "text.color": "#243B2F",
            "axes.labelcolor": "#405047",
            "text.parse_math": False,
            "legend.frameon": False,
        },
    )


def chart(fig, title: str, subtitle: str, source: str) -> None:
    fig.text(0.08, 0.98, title, ha="left", va="top", fontsize=17, fontweight="semibold")
    fig.text(0.08, 0.90, subtitle, ha="left", va="top", fontsize=10, color="#58685F")
    fig.tight_layout(rect=(0.02, 0.11, 1, 0.82))
    fig.text(0.08, 0.03, source, fontsize=8, color="#6C7D73")
    plt.show()
