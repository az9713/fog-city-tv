"""Fog City TV local server: serves the site and a small Claude API proxy.

Run:  python server.py            (then open http://localhost:8080)

The Fog City Talk channel sends its requests to /api/claude on this server. The server adds the
API key and forwards them to the Claude API, so the key never reaches the browser.

The key is read from the ANTHROPIC_API_KEY environment variable, or from a file named
.anthropic_key next to this script (one line). That file is listed in .gitignore. Without a key
the site still works and the talk channel shows "off the air".

Standard library only: no pip install needed.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8080"))
DAILY_LIMIT = int(os.environ.get("TALK_DAILY_LIMIT", "300"))   # Claude requests per day

# Kept in step with worker/worker.js.
API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-opus-5-5"
MAX_TOKENS = 2048
EFFORT = "low"                      # short spoken answers: low effort is fast and cheap
BETAS = "server-side-fallback-2026-07-01"
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}
MAX_BODY = 400_000


def load_key():
    k = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if k:
        return k
    p = os.path.join(ROOT, ".anthropic_key")
    if os.path.exists(p):
        with open(p, encoding="utf-8-sig") as f:
            return f.read().strip()
    return ""


def build_request(body):
    """Accept only what the channel needs; the model and limits are fixed here, not by the page."""
    msgs = body.get("messages")
    if not isinstance(msgs, list) or not msgs or len(msgs) > 80:
        raise ValueError("messages must be a non-empty list")
    system = body.get("system", "")
    if not isinstance(system, str) or len(system) > 12000:
        raise ValueError("bad system prompt")
    tools = []
    for t in body.get("tools", [])[:12]:
        if not isinstance(t, dict) or "type" in t or not {"name", "input_schema"} <= t.keys():
            raise ValueError("only custom tools are allowed")
        tools.append({k: t[k] for k in ("name", "description", "input_schema") if k in t})
    if body.get("web_search", True):
        tools.append(WEB_SEARCH)
    return {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": msgs,
        "tools": tools,
        "output_config": {"effort": EFFORT},
        "fallbacks": "default",
    }


class Handler(SimpleHTTPRequestHandler):
    usage = {"day": "", "count": 0}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        # Never serve dotfiles (the key file) or the server source.
        name = self.path.split("?")[0].rsplit("/", 1)[-1]
        if name.startswith(".") or "/." in self.path or name == "server.py":
            self.send_error(404)
            return
        if self.path.startswith("/api/claude"):
            self.reply(200 if load_key() else 503, {"ok": bool(load_key()), "model": MODEL})
            return
        super().do_GET()

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/claude":
            self.send_error(404)
            return
        key = load_key()
        if not key:
            self.reply(503, {"error": "no_key", "message": "No API key: create .anthropic_key next to server.py."})
            return
        day = time.strftime("%Y-%m-%d")
        if Handler.usage["day"] != day:
            Handler.usage = {"day": day, "count": 0}
        if Handler.usage["count"] >= DAILY_LIMIT:
            self.reply(429, {"error": "daily_limit", "message": f"Daily limit of {DAILY_LIMIT} requests reached."})
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            self.reply(413, {"error": "too_large"})
            return
        try:
            req_body = build_request(json.loads(self.rfile.read(n)))
        except (ValueError, json.JSONDecodeError) as e:
            self.reply(400, {"error": "bad_request", "message": str(e)})
            return
        Handler.usage["count"] += 1
        up = urllib.request.Request(API_URL, data=json.dumps(req_body).encode(), method="POST", headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": BETAS,
        })
        try:
            with urllib.request.urlopen(up, timeout=180) as r:
                self.reply(r.status, json.loads(r.read()))
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read())
            except Exception:
                err = {"error": {"message": str(e)}}
            self.reply(e.code, err)
        except Exception as e:  # network trouble
            self.reply(502, {"error": "upstream", "message": str(e)})

    def log_message(self, fmt, *args):
        if "/api/claude" in (self.path or ""):
            sys.stderr.write("[talk] %s\n" % (fmt % args))


if __name__ == "__main__":
    print(f"Fog City TV on http://localhost:{PORT}")
    print("Claude channel:", "ready" if load_key() else "off the air (no .anthropic_key)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
