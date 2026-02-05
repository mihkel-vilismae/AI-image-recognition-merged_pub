# Server Endpoints Reference

This document describes every HTTP endpoint exposed by the FastAPI server in `server/app/main.py`.

Base URL during local development:
- `http://localhost:8000`

---

## 1) `GET /health`

### Purpose
Simple liveness probe to confirm the backend process is up.

### Request
- Method: `GET`
- Path: `/health`
- Query params: none
- Body: none

### Success response
- Status: `200 OK`
- Body:

```json
{ "ok": true }
```

### Typical usage
- Browser quick check (`/health`)
- Docker/Kubernetes health checks
- Frontend/dev scripts checking backend availability

---

## 2) `POST /detect`

### Purpose
Run YOLO object detection on a single uploaded image.

### Request
- Method: `POST`
- Path: `/detect`
- Query params:
  - `conf` (`float`, default `0.25`) — confidence threshold for filtering detections
- Multipart form-data:
  - `file` (`UploadFile`, required) — input image

### Success response
- Status: `200 OK`
- Body shape:

```json
{
  "count": 2,
  "boxes": [
    {
      "name": "person",
      "score": 0.93,
      "xyxy": [10.0, 20.0, 110.0, 220.0]
    }
  ]
}
```

Where:
- `count` = number of returned detections
- `boxes[]` = detection list
  - `name` = class label from YOLO model names
  - `score` = confidence score in `[0, 1]`
  - `xyxy` = `[x1, y1, x2, y2]` coordinates in source-image pixel space

### Error response
- Status: `500 Internal Server Error`
- Body shape:

```json
{
  "error": "Detection failed",
  "message": "<exception message>"
}
```

### Notes
- Uses lazy-loaded `YOLO("yolov8x.pt")` model.
- CORS allows Vite dev origins (`localhost:5173` and `localhost:5174`).

---

## 3) `POST /detect-video`

### Purpose
Run YOLO detection over sampled frames from an uploaded video.

### Request
- Method: `POST`
- Path: `/detect-video`
- Query params:
  - `conf` (`float`, default `0.25`) — confidence threshold
  - `stride` (`int`, default `15`) — sample every Nth frame
  - `max_frames` (`int`, default `20`) — maximum number of sampled frames to process
- Multipart form-data:
  - `file` (`UploadFile`, required) — input video

### Validation rules
- `stride` must be `>= 1`
- `max_frames` must be `>= 1`

Validation errors return `400` with:

```json
{ "error": "stride must be >= 1" }
```

or

```json
{ "error": "max_frames must be >= 1" }
```

### Success response
- Status: `200 OK`
- Body shape:

```json
{
  "frame_count": 481,
  "sampled_count": 20,
  "samples": [
    {
      "frame_index": 0,
      "time_sec": 0.0,
      "count": 2,
      "boxes": [
        {
          "name": "person",
          "score": 0.94,
          "xyxy": [0.7, 307.1, 157.3, 847.0]
        }
      ]
    }
  ]
}
```

Where:
- `frame_count` = total decoded frames in video
- `sampled_count` = number of sampled frames actually processed
- `samples[]` = sampled-frame results
  - `frame_index` = source frame index
  - `time_sec` = timestamp (`frame_index / fps`) or `null` when fps unknown
  - `count` = detections in this sampled frame
  - `boxes[]` = same schema as `/detect`

### Error responses
- Status: `400 Bad Request`
  - invalid parameters
  - unreadable/invalid video input
- Status: `500 Internal Server Error`

```json
{
  "error": "Video detection failed",
  "message": "<exception message>"
}
```

### Notes
- Uploaded file is written to a temporary file and cleaned up in `finally`.
- Frame decode uses OpenCV; inference uses the same YOLO model as image detection.
- This endpoint returns detection data only (it does not return a rendered video).

---

## Startup behavior (non-HTTP)

On application startup, the server logs LAN-accessible URLs inferred from local non-loopback IPv4 addresses. This helps users on the same network connect from phones/laptops.
