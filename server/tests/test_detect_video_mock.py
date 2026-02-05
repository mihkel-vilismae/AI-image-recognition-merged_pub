from __future__ import annotations

import io
import sys
from types import SimpleNamespace

from fastapi.testclient import TestClient
import numpy as np

import app.main as main


class _FakeCapture:
    def __init__(self, _path: str):
        self._frames = [np.zeros((4, 4, 3), dtype=np.uint8) for _ in range(4)]
        self._idx = 0

    def isOpened(self):
        return True

    def get(self, prop):
        if prop == 5:
            return 10.0
        return 0.0

    def read(self):
        if self._idx >= len(self._frames):
            return False, None
        frame = self._frames[self._idx]
        self._idx += 1
        return True, frame

    def release(self):
        return None


class _FakeModel:
    names = {0: 'object'}

    def predict(self, _frame, conf=0.25, verbose=False):
        assert conf == 0.25
        return [SimpleNamespace(boxes=SimpleNamespace(
            xyxy=np.array([[1.0, 2.0, 3.0, 4.0]]),
            conf=np.array([0.8]),
            cls=np.array([0]),
        ))]


def test_detect_video_returns_sampled_frames(monkeypatch):
    monkeypatch.setattr(main, 'get_model', lambda: _FakeModel())
    monkeypatch.setitem(sys.modules, 'cv2', SimpleNamespace(VideoCapture=_FakeCapture, CAP_PROP_FPS=5))

    app = main.create_app()
    client = TestClient(app)

    payload = io.BytesIO(b'fake-video-bytes')
    response = client.post(
        '/detect-video?conf=0.25&stride=2&max_frames=3',
        files={'file': ('sample.mp4', payload.getvalue(), 'video/mp4')},
    )

    assert response.status_code == 200
    data = response.json()
    assert data['frame_count'] == 4
    assert data['sampled_count'] == 2
    assert data['samples'][0]['frame_index'] == 0
    assert data['samples'][1]['frame_index'] == 2
    assert data['samples'][0]['boxes'][0]['name'] == 'object'


def test_detect_video_validates_limits():
    app = main.create_app()
    client = TestClient(app)

    response = client.post(
        '/detect-video?stride=0',
        files={'file': ('sample.mp4', b'v', 'video/mp4')},
    )

    assert response.status_code == 400
    assert response.json()['error'] == 'stride must be >= 1'
