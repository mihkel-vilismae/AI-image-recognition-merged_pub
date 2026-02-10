# WebRTC Signaling Relay

Run this relay on your PC so phone and viewer can exchange signaling messages.

```bash
cd tools/webrtc-relay
pip install websockets
python server.py
```

Services exposed:
- WebSocket relay: `ws://0.0.0.0:8765`
- HTTP health: `http://0.0.0.0:8766/health`
