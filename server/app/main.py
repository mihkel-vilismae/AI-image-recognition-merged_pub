from __future__ import annotations

import io
import json
import logging
import os
from pathlib import Path
import socket
import tempfile
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import numpy as np
from PIL import Image
import torch


# Lazy model creation so tests can monkeypatch it without downloading weights.
_model: Optional[Any] = None
logger = logging.getLogger(__name__)
LOGS_DIR = Path(__file__).resolve().parents[2] / "logs"
ANALYTICS_LOG_FILE = LOGS_DIR / "detection_analytics.jsonl"
SIGNALING_RELAY_FILE = Path(__file__).resolve().parents[1] / "server.py"

SIGNALING_RELAY_SOURCE = """import asyncio
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
"""



def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"


def _append_analysis_log(entry: Dict[str, Any]) -> None:
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with ANALYTICS_LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        logger.warning("Could not append analytics log", exc_info=True)


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO

        # Biggest common pretrained model in YOLOv8 family.
        _model = YOLO("yolov8x.pt")
    return _model


def _network_urls_for_ips(ips: List[str], port: int) -> List[str]:
    cleaned = sorted({ip for ip in ips if ip and not ip.startswith("127.") and not ip.startswith("169.254.")})
    return [f"http://{ip}:{port}" for ip in cleaned]


def _discover_local_ips() -> List[str]:
    ips: set[str] = set()

    try:
        host_ips = socket.gethostbyname_ex(socket.gethostname())[2]
        ips.update(host_ips)
    except OSError:
        pass

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ips.add(sock.getsockname()[0])
    except OSError:
        pass

    return sorted(ips)


def _is_rfc1918_ip(ip: str) -> bool:
    if ip.startswith("10.") or ip.startswith("192.168."):
        return True
    if not ip.startswith("172."):
        return False
    try:
        second = int(ip.split(".")[1])
    except (ValueError, IndexError):
        return False
    return 16 <= second <= 31


def _lan_ip_candidates() -> List[str]:
    ips = sorted({ip for ip in _discover_local_ips() if ip and not ip.startswith("127.") and not ip.startswith("169.254.")})
    if not ips:
        return ["127.0.0.1"]

    preferred = sorted((ip for ip in ips if _is_rfc1918_ip(ip)))
    rest = [ip for ip in ips if ip not in preferred]
    return preferred + rest


def _ensure_signaling_relay_script() -> Path:
    SIGNALING_RELAY_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not SIGNALING_RELAY_FILE.exists():
        SIGNALING_RELAY_FILE.write_text(SIGNALING_RELAY_SOURCE, encoding="utf-8")
    return SIGNALING_RELAY_FILE


def _phone_publisher_html(ip: str, signaling_port: int = 8765) -> str:
    ws_url = f"ws://{ip}:{signaling_port}"
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Phone Publisher</title>
    <style>
      body {{ font-family: system-ui, sans-serif; margin: 16px; background: #0b0f17; color: #e9eef7; }}
      button {{ margin-right: 8px; margin-bottom: 8px; }}
      video {{ width: 100%; max-width: 480px; background: #000; border-radius: 8px; }}
      pre {{ background: #111a2b; padding: 10px; border-radius: 8px; white-space: pre-wrap; }}
      #error {{ color: #ff5c7a; }}
    </style>
  </head>
  <body>
    <h1>Phone camera publisher</h1>
    <p>Signaling: <code>{ws_url}</code></p>
    <button id="btnFront" type="button">Front camera</button>
    <button id="btnBack" type="button">Back camera</button>
    <video id="preview" autoplay muted playsinline></video>
    <pre id="log"></pre>
    <pre id="error"></pre>

    <script>
      const SIGNALING_URL = {ws_url!r};
      const preview = document.getElementById('preview');
      const logEl = document.getElementById('log');
      const errorEl = document.getElementById('error');
      const btnFront = document.getElementById('btnFront');
      const btnBack = document.getElementById('btnBack');

      let socket = null;
      let pc = null;
      let stream = null;
      let facingMode = 'environment';

      function log(msg) {{ logEl.textContent += msg + '\n'; }}
      function setError(msg) {{ errorEl.textContent = msg || ''; }}

      async function cleanup() {{
        if (stream) {{
          stream.getTracks().forEach((t) => t.stop());
          stream = null;
        }}
        if (pc) {{
          try {{ pc.close(); }} catch (_) {{}}
          pc = null;
        }}
      }}

      function send(payload) {{
        if (socket && socket.readyState === WebSocket.OPEN) {{
          socket.send(JSON.stringify(payload));
        }}
      }}

      async function startPublisher(nextFacingMode) {{
        facingMode = nextFacingMode;
        setError('');
        await cleanup();

        stream = await navigator.mediaDevices.getUserMedia({{ video: {{ facingMode }}, audio: false }});
        preview.srcObject = stream;

        pc = new RTCPeerConnection();
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.onicecandidate = (event) => {{
          if (!event.candidate) return;
          send({{ type: 'candidate', candidate: event.candidate }});
        }};

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({{ type: 'offer', sdp: offer.sdp }});
        log(`Offer sent (${facingMode})`);
      }}

      function connectSocket() {{
        socket = new WebSocket(SIGNALING_URL);
        socket.addEventListener('open', async () => {{
          log('Socket connected');
          try {{
            await startPublisher(facingMode);
          }} catch (err) {{
            setError(String(err));
          }}
        }});

        socket.addEventListener('message', async (event) => {{
          try {{
            const msg = JSON.parse(event.data);
            if (msg.type === 'answer' && msg.sdp && pc) {{
              await pc.setRemoteDescription({{ type: 'answer', sdp: msg.sdp }});
              log('Answer applied');
            }}
            if (msg.type === 'candidate' && msg.candidate && pc) {{
              await pc.addIceCandidate(msg.candidate);
            }}
          }} catch (err) {{
            setError(String(err));
          }}
        }});

        socket.addEventListener('error', () => setError('WebSocket signaling error'));
      }}

      btnFront.addEventListener('click', async () => {{
        try {{ await startPublisher('user'); }} catch (err) {{ setError(String(err)); }}
      }});
      btnBack.addEventListener('click', async () => {{
        try {{ await startPublisher('environment'); }} catch (err) {{ setError(String(err)); }}
      }});

      connectSocket();
    </script>
  </body>
</html>
"""


def _log_network_access_urls(port: int) -> None:
    urls = _network_urls_for_ips(_discover_local_ips(), port)
    if not urls:
        logger.info("No non-loopback IPv4 address discovered for LAN access.")
        return

    logger.info("LAN access URLs:")
    for url in urls:
        logger.info("  %s", url)


def _to_numpy(value: Any, dtype: Any | None = None) -> np.ndarray:
    if isinstance(value, torch.Tensor):
        array = value.detach().cpu().numpy()
        if dtype is not None:
            return array.astype(dtype)
        return array
    return np.asarray(value, dtype=dtype)


def _box_xyxy_list(xyxy: Any) -> List[float]:
    xyxy_arr = _to_numpy(xyxy)
    if xyxy_arr.ndim > 1:
        xyxy_arr = xyxy_arr[0]
    return [float(v) for v in xyxy_arr.tolist()]


def _results_to_boxes(result: Any, model_names: Dict[int, str]) -> List[Dict[str, Any]]:
    boxes = getattr(result, "boxes", None)
    if boxes is None:
        return []

    if hasattr(boxes, "xyxy"):
        xyxy_arr = _to_numpy(boxes.xyxy)
        conf_arr = (
            _to_numpy(boxes.conf, dtype=float) if getattr(boxes, "conf", None) is not None else None
        )
        cls_arr = _to_numpy(boxes.cls, dtype=int) if getattr(boxes, "cls", None) is not None else None

        output: List[Dict[str, Any]] = []
        for idx in range(len(xyxy_arr)):
            cls_id = int(cls_arr[idx]) if cls_arr is not None else -1
            name = model_names.get(cls_id, str(cls_id))
            score = float(conf_arr[idx]) if conf_arr is not None else 0.0
            xyxy_list = [float(v) for v in xyxy_arr[idx].tolist()]
            output.append({"name": name, "score": score, "xyxy": xyxy_list})
        return output

    output = []
    for box in boxes:
        cls_arr = _to_numpy(box.cls, dtype=int)
        conf_arr = _to_numpy(box.conf, dtype=float)
        xyxy_arr = _to_numpy(box.xyxy)
        cls_id = int(np.ravel(cls_arr)[0])
        name = model_names.get(cls_id, str(cls_id))
        score = float(np.ravel(conf_arr)[0])
        xyxy_list = _box_xyxy_list(xyxy_arr)
        output.append({"name": name, "score": score, "xyxy": xyxy_list})
    return output


def _to_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _detect_video_samples(video_path: str, conf: float, stride: int, max_frames: int) -> Dict[str, Any]:
    import cv2

    capture = cv2.VideoCapture(video_path)
    if not capture.isOpened():
        raise ValueError("Could not open uploaded video")

    fps = _to_float(capture.get(cv2.CAP_PROP_FPS), 0.0)
    if fps <= 0:
        fps = 0.0

    model = get_model()
    frame_index = 0
    sampled: List[Dict[str, Any]] = []

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        should_sample = frame_index % stride == 0 and len(sampled) < max_frames
        if should_sample:
            req_time = time.time()
            req_iso = _now_iso()

            results = model.predict(frame, conf=conf, verbose=False)
            boxes = _results_to_boxes(results[0], model.names)

            done_time = time.time()
            duration_ms = int(round((done_time - req_time) * 1000))
            done_iso = _now_iso()

            sampled.append(
                {
                    "frame_index": frame_index,
                    "time_sec": round((frame_index / fps), 3) if fps > 0 else None,
                    "count": len(boxes),
                    "boxes": boxes,
                    "detection_request_at": req_iso,
                    "detection_completed_at": done_iso,
                    "detection_duration": duration_ms,
                }
            )

        frame_index += 1

    capture.release()
    return {"frame_count": frame_index, "sampled_count": len(sampled), "samples": sampled}


def create_app() -> FastAPI:
    app = FastAPI(title="AI Image Recognition", version="0.1.0")

    # DEV CORS configuration for browser-based health/debug flows.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def dev_request_logging(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%.1f origin=%s referer=%s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request.headers.get("origin", ""),
            request.headers.get("referer", ""),
        )
        return response

    @app.on_event("startup")
    async def log_network_info() -> None:
        port = int(os.getenv("PORT", os.getenv("UVICORN_PORT", "8000")))
        _log_network_access_urls(port)

    @app.get("/health")
    def health(request: Request) -> Dict[str, str | bool]:
        logger.info(
            "health_hit method=%s path=%s client=%s user_agent=%s origin=%s",
            request.method,
            request.url.path,
            request.client.host if request.client else "unknown",
            request.headers.get("user-agent", ""),
            request.headers.get("origin", ""),
        )
        return {
            "ok": True,
            "service": "ai-server",
            "ts": datetime.utcnow().isoformat() + "Z",
        }

    @app.get("/webrtc/network")
    def webrtc_network() -> Dict[str, Any]:
        candidates = _lan_ip_candidates()
        warning = candidates == ["127.0.0.1"]
        return {
            "ipCandidates": candidates,
            "selectedIp": candidates[0],
            "warning": warning,
        }

    @app.get("/webrtc/relay-info")
    def webrtc_relay_info() -> Dict[str, Any]:
        relay_path = _ensure_signaling_relay_script()
        return {
            "relayPath": str(relay_path),
            "relayExists": relay_path.exists(),
            "runCommands": [f"cd {relay_path.parent}", "python server.py"],
            "relayCode": relay_path.read_text(encoding="utf-8"),
        }

    @app.get("/webrtc/phone-publisher")
    def webrtc_phone_publisher(ip: Optional[str] = Query(default=None)) -> Dict[str, Any]:
        candidates = _lan_ip_candidates()
        selected = ip.strip() if ip and ip.strip() else candidates[0]
        if selected not in candidates:
            candidates = sorted(set(candidates + [selected]))
        warning = candidates == ["127.0.0.1"]
        return {
            "ipCandidates": candidates,
            "selectedIp": selected,
            "warning": warning,
            "html": _phone_publisher_html(selected, signaling_port=8765),
        }

    @app.get("/webrtc/network")
    def webrtc_network() -> Dict[str, Any]:
        candidates = _lan_ip_candidates()
        warning = candidates == ["127.0.0.1"]
        return {
            "ipCandidates": candidates,
            "selectedIp": candidates[0],
            "warning": warning,
        }

    @app.get("/webrtc/relay-info")
    def webrtc_relay_info() -> Dict[str, Any]:
        relay_path = _ensure_signaling_relay_script()
        return {
            "relayPath": str(relay_path),
            "relayExists": relay_path.exists(),
            "runCommands": [f"cd {relay_path.parent}", "python server.py"],
            "relayCode": relay_path.read_text(encoding="utf-8"),
        }

    @app.get("/webrtc/phone-publisher")
    def webrtc_phone_publisher(ip: Optional[str] = Query(default=None)) -> Dict[str, Any]:
        candidates = _lan_ip_candidates()
        selected = ip.strip() if ip and ip.strip() else candidates[0]
        if selected not in candidates:
            candidates = sorted(set(candidates + [selected]))
        warning = candidates == ["127.0.0.1"]
        return {
            "ipCandidates": candidates,
            "selectedIp": selected,
            "warning": warning,
            "html": _phone_publisher_html(selected, signaling_port=8765),
        }

    @app.post("/detect")
    @app.post("/api/detect")
    async def detect(file: UploadFile = File(...), conf: float = 0.25) -> Dict[str, Any]:
        data = await file.read()
        img = Image.open(io.BytesIO(data)).convert("RGB")

        req_time = time.time()
        req_iso = _now_iso()

        try:
            model = get_model()
            results = model.predict(img, conf=float(conf), verbose=False)
            r = results[0]

            boxes = _results_to_boxes(r, model.names)
            done_time = time.time()
            duration_ms = int(round((done_time - req_time) * 1000))
            done_iso = _now_iso()

            payload = {
                "count": len(boxes),
                "boxes": boxes,
                "detection_request_at": req_iso,
                "detection_completed_at": done_iso,
                "detection_duration": duration_ms,
            }
            _append_analysis_log(
                {
                    "endpoint": "/detect",
                    "request_at": req_iso,
                    "completed_at": done_iso,
                    "duration_ms": duration_ms,
                    "box_count": len(boxes),
                }
            )
            return payload
        except Exception as exc:
            logger.exception("Detection failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Detection failed", "message": str(exc)},
            )

    @app.post("/detect-video")
    async def detect_video(
        file: UploadFile = File(...),
        conf: float = 0.25,
        stride: int = 15,
        max_frames: int = 20,
    ) -> Dict[str, Any]:
        if stride < 1:
            return JSONResponse(status_code=400, content={"error": "stride must be >= 1"})
        if max_frames < 1:
            return JSONResponse(status_code=400, content={"error": "max_frames must be >= 1"})

        data = await file.read()
        suffix = ".mp4"
        if file.filename and "." in file.filename:
            suffix = "." + file.filename.rsplit(".", 1)[1]

        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(data)
                temp_path = tmp.name

            started_at = _now_iso()
            t0 = time.time()
            payload = _detect_video_samples(
                video_path=temp_path,
                conf=float(conf),
                stride=int(stride),
                max_frames=int(max_frames),
            )
            duration_ms = int(round((time.time() - t0) * 1000))
            completed_at = _now_iso()

            _append_analysis_log(
                {
                    "endpoint": "/detect-video",
                    "request_at": started_at,
                    "completed_at": completed_at,
                    "duration_ms": duration_ms,
                    "frame_count": payload.get("frame_count"),
                    "sampled_count": payload.get("sampled_count"),
                    "avg_sample_ms": round(
                        sum(sample.get("detection_duration", 0) for sample in payload.get("samples", []))
                        / max(1, len(payload.get("samples", []))),
                        2,
                    ),
                }
            )
            return payload
        except ValueError as exc:
            return JSONResponse(status_code=400, content={"error": str(exc)})
        except Exception as exc:
            logger.exception("Video detection failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Video detection failed", "message": str(exc)},
            )
        finally:
            try:
                if "temp_path" in locals() and os.path.exists(temp_path):
                    os.unlink(temp_path)
            except Exception:
                logger.warning("Could not remove temp video file", exc_info=True)

    return app


app = create_app()
