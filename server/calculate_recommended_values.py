from __future__ import annotations

import json
from pathlib import Path
from statistics import median

LOG_FILE = Path(__file__).resolve().parents[1] / "logs" / "detection_analytics.jsonl"


def _percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    idx = (len(ordered) - 1) * p
    low = int(idx)
    high = min(low + 1, len(ordered) - 1)
    frac = idx - low
    return ordered[low] * (1 - frac) + ordered[high] * frac


def main() -> None:
    if not LOG_FILE.exists():
        print(f"No log file found at {LOG_FILE}")
        return

    detect_video_rows: list[dict] = []
    durations: list[float] = []
    sampled_counts: list[float] = []

    for line in LOG_FILE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("endpoint") != "/detect-video":
            continue
        detect_video_rows.append(row)
        if isinstance(row.get("avg_sample_ms"), (int, float)):
            durations.append(float(row["avg_sample_ms"]))
        if isinstance(row.get("sampled_count"), (int, float)):
            sampled_counts.append(float(row["sampled_count"]))

    if not detect_video_rows:
        print("No /detect-video analytics found yet.")
        return

    p50_ms = median(durations) if durations else 0.0
    p90_ms = _percentile(durations, 0.9) if durations else 0.0

    # Rule-of-thumb: sample interval should target >2x p90 compute budget.
    # Assuming typical 30fps, stride ~= ceil((2 * p90_ms) / (1000/30)).
    frame_ms = 1000 / 30.0
    recommended_stride = max(1, int(round((2.0 * p90_ms) / frame_ms)))

    # Rule-of-thumb max sampled frames: median observed sampled count, capped to 200.
    recommended_max_frames = int(min(200, max(1, round(median(sampled_counts) if sampled_counts else 20))))

    print("Recommended values based on logs:")
    print(f"- Sample every N frames (stride): {recommended_stride}")
    print(f"- Max sampled frames: {recommended_max_frames}")
    print(f"- Avg sample duration p50: {p50_ms:.2f} ms")
    print(f"- Avg sample duration p90: {p90_ms:.2f} ms")
    print(f"- Source rows analyzed: {len(detect_video_rows)}")


if __name__ == "__main__":
    main()
