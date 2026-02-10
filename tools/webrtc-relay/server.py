import asyncio
import websockets

clients = set()


async def relay(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            for client in tuple(clients):
                if client is websocket:
                    continue
                try:
                    await client.send(message)
                except Exception:
                    pass
    finally:
        clients.discard(websocket)


async def main():
    async with websockets.serve(relay, "0.0.0.0", 8765):
        print("WebSocket relay listening on ws://0.0.0.0:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
