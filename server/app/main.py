from __future__ import annotations

import io
import logging
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


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO

        # Biggest common pretrained model in YOLOv8 family.
        _model = YOLO("yolov8x.pt")
    return _model


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


def create_app() -> FastAPI:
    app = FastAPI(title="AI Image Recognition", version="0.1.0")

    # Vite dev server origin; expand for production if needed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"] ,
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> Dict[str, bool]:
        return {"ok": True}

    @app.post("/detect")
    async def detect(file: UploadFile = File(...), conf: float = 0.25) -> Dict[str, Any]:
        data = await file.read()
        img = Image.open(io.BytesIO(data)).convert("RGB")

        try:
            model = get_model()
            results = model.predict(img, conf=float(conf), verbose=False)
            r = results[0]

            boxes = _results_to_boxes(r, model.names)
            return {"count": len(boxes), "boxes": boxes}
        except Exception as exc:
            logger.exception("Detection failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Detection failed", "message": str(exc)},
            )

    return app


app = create_app()
