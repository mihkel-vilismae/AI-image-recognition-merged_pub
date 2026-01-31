from __future__ import annotations

import io
from dataclasses import dataclass

from fastapi.testclient import TestClient
import numpy as np
from PIL import Image

import app.main as main


class _FakeBox:
    def __init__(self):
        self.cls = np.array([0])
        self.conf = np.array([0.9])
        self.xyxy = np.array([[10.0, 20.0, 110.0, 220.0]])


class _FakeResult:
    def __init__(self):
        self.boxes = [_FakeBox()]


class _FakeModel:
    names = {0: "resistor"}

    def predict(self, img, conf=0.25, verbose=False):
        assert conf == 0.42
        return [_FakeResult()]


def test_detect_returns_boxes(monkeypatch):
    monkeypatch.setattr(main, "get_model", lambda: _FakeModel())

    app = main.create_app()
    client = TestClient(app)

    im = Image.new("RGB", (320, 240), (0, 0, 0))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    buf.seek(0)

    r = client.post(
        "/detect?conf=0.42",
        files={"file": ("test.png", buf.getvalue(), "image/png")},
    )
    assert r.status_code == 200
    j = r.json()
    assert j["count"] == 1
    assert j["boxes"][0]["name"] == "resistor"
    assert abs(j["boxes"][0]["score"] - 0.9) < 1e-9
    assert j["boxes"][0]["xyxy"] == [10.0, 20.0, 110.0, 220.0]
