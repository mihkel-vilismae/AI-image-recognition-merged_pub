from __future__ import annotations

import io
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image


# Lazy model creation so tests can monkeypatch it without downloading weights.
_model: Optional[Any] = None


def get_model():
    global _model
    if _model is None:
        from ultralytics import YOLO

        # Biggest common pretrained model in YOLOv8 family.
        _model = YOLO("yolov8x.pt")
    return _model


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

        model = get_model()
        results = model.predict(img, conf=float(conf), verbose=False)
        r = results[0]

        boxes: List[Dict[str, Any]] = []
        if getattr(r, "boxes", None) is not None:
            for b in r.boxes:
                cls = int(b.cls[0])
                name = model.names.get(cls, str(cls))
                score = float(b.conf[0])
                xyxy = b.xyxy[0].tolist()
                boxes.append({"name": name, "score": score, "xyxy": xyxy})

        return {"count": len(boxes), "boxes": boxes}

    return app


app = create_app()
