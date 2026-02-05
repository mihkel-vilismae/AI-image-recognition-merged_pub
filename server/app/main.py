from __future__ import annotations

import io
import json
import logging
import os
from pathlib import Path
import socket
import tempfile
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, UploadFile
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

    # Vite dev server origin; expand for production if needed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:5174"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def log_network_info() -> None:
        port = int(os.getenv("PORT", os.getenv("UVICORN_PORT", "8000")))
        _log_network_access_urls(port)

    @app.get("/health")
    def health() -> Dict[str, bool]:
        return {"ok": True}

    @app.post("/detect")
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
