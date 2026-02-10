import asyncio
import contextlib
import websockets
from websockets.exceptions import ConnectionClosed

clients = set()


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
