from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pytest
import torch

from app.main import _results_to_boxes


@dataclass
class _FakeBoxes:
    xyxy: torch.Tensor
    conf: torch.Tensor
    cls: torch.Tensor


class _FakeResult:
    def __init__(self, boxes):
        self.boxes = boxes


def _assert_box_payload(boxes):
    assert boxes[0]["name"] == "resistor"
    assert boxes[0]["score"] == pytest.approx(0.9, rel=1e-6)
    assert boxes[0]["xyxy"] == [10.0, 20.0, 110.0, 220.0]
    for value in boxes[0]["xyxy"]:
        assert isinstance(value, float)
    assert isinstance(boxes[0]["score"], float)


def test_results_to_boxes_cpu_tensor():
    boxes = _FakeBoxes(
        xyxy=torch.tensor([[10.0, 20.0, 110.0, 220.0]]),
        conf=torch.tensor([0.9]),
        cls=torch.tensor([0]),
    )
    result = _FakeResult(boxes)

    output = _results_to_boxes(result, {0: "resistor"})
    _assert_box_payload(output)


def test_results_to_boxes_cpu_array():
    boxes = _FakeBoxes(
        xyxy=torch.from_numpy(np.array([[10.0, 20.0, 110.0, 220.0]])),
        conf=torch.from_numpy(np.array([0.9])),
        cls=torch.from_numpy(np.array([0])),
    )
    result = _FakeResult(boxes)

    output = _results_to_boxes(result, {0: "resistor"})
    _assert_box_payload(output)


def test_results_to_boxes_cuda_tensor():
    if not torch.cuda.is_available():
        return
    boxes = _FakeBoxes(
        xyxy=torch.tensor([[10.0, 20.0, 110.0, 220.0]], device="cuda"),
        conf=torch.tensor([0.9], device="cuda"),
        cls=torch.tensor([0], device="cuda"),
    )
    result = _FakeResult(boxes)

    output = _results_to_boxes(result, {0: "resistor"})
    _assert_box_payload(output)
