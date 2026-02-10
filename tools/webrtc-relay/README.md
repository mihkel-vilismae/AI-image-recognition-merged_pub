# WebRTC Signaling Relay

Run this relay on your PC so phone and viewer can exchange signaling messages.

```bash
cd tools/webrtc-relay
pip install websockets
python server.py
```

The relay listens on `ws://0.0.0.0:8765`.
