import asyncio
import contextlib
import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import websockets
from websockets.exceptions import ConnectionClosed

clients = set()
VERSION = "1.1.0"
HEALTH_PORT = 8766


class HealthHandler(BaseHTTPRequestHandler):
    def _write_json(self, status: int, payload: dict):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/health":
            self._write_json(
                200,
                {
                    "ok": True,
                    "service": "webrtc-signaling-relay",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "version": VERSION,
                    "ws": "ws://0.0.0.0:8765",
                    "http": f"http://0.0.0.0:{HEALTH_PORT}/health",
                },
            )
            return
        self._write_json(404, {"ok": False, "error": "not_found"})

    def log_message(self, _format, *_args):
        return


def start_health_server():
    server = ThreadingHTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    print(f"Health endpoint listening on http://0.0.0.0:{HEALTH_PORT}/health")
    server.serve_forever()


async def relay(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            for client in tuple(clients):
                if client is websocket:
                    continue
                with contextlib.suppress(Exception):
                    await client.send(message)
    except (ConnectionClosed, ConnectionResetError, OSError):
        pass
    finally:
        clients.discard(websocket)


async def main():
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()

    async with websockets.serve(
        relay,
        "0.0.0.0",
        8765,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=2,
    ):
        print("WebSocket relay listening on ws://0.0.0.0:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
