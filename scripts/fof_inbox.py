#!/usr/bin/env python3
"""Local inbox for FoF HTML saved from the logged-in browser session.

Binds to 127.0.0.1 only. The browser posts page HTML here because EQ Resource
is behind Cloudflare and a premium login that plain HTTP clients cannot reuse.
"""

from __future__ import annotations

import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

REPO = Path(__file__).resolve().parents[1]
RAW = REPO / "cache" / "raw" / "fof"
HOST = "127.0.0.1"
PORT = 8791
MAX_BODY = 2_000_000
_NAME_RE = re.compile(
    r"^(raidarmor|raidgear_(?:1h|2h|hth|bow)"
    r"|raidgear_(?:back|charm|ear|face|finger|neck|rangex|shoulder|waist)_t[12]"
    r"|items/\d+)\.html$"
)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code: int, body: bytes, content_type: str = "text/plain; charset=utf-8") -> None:
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, b"")

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/status":
            self._send(404, b"not found")
            return
        names = []
        if RAW.is_dir():
            for path in RAW.rglob("*.html"):
                names.append(path.relative_to(RAW).as_posix())
        body = ("\n".join(sorted(names)) + ("\n" if names else "")).encode("utf-8")
        self._send(200, body)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/save":
            self._send(404, b"not found")
            return
        name = (parse_qs(parsed.query).get("name") or [""])[0]
        if not _NAME_RE.fullmatch(name):
            self._send(400, b"bad name")
            return
        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_BODY:
            self._send(400, b"bad length")
            return
        raw = self.rfile.read(length)
        dest = RAW / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        print(f"saved {name} ({length})", flush=True)
        self._send(200, b"ok")

    def log_message(self, fmt: str, *args) -> None:
        return


def main() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"FoF inbox on http://{HOST}:{PORT}/save", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
