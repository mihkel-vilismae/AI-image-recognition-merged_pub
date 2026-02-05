# Web Interface Guide

This document explains the web UI pages, controls, and what each button/action does.

Default development URLs:
- Image page: `http://localhost:5173/`
- Video page: `http://localhost:5173/videos.html`

---

## 1) Image page (`/`)

### Header
- **Status badge** (`Idle`, `Ready`, `Detecting…`, `Done`, `Error`)
  - Reflects current detection workflow state.
- **Videos link**
  - Navigates to video page (`/videos.html`).

### Section: `1) Choose image`
- **Drop zone + file input**
  - Click to open file picker
  - Drag & drop image file
- **Confidence slider**
  - Sets `conf` query parameter sent to backend `/detect`
  - Range `0.00` to `1.00`
- **Detect button**
  - Disabled until an image is selected
  - Sends `POST /detect` multipart request
- **Clipboard paste (`Ctrl+V`)**
  - If clipboard contains an image file, auto-selects it as current input

### Section: `2) Preview`
- **Canvas preview**
  - Shows selected image
  - Draws detection rectangles and labels after detection
  - Hovering a box highlights it

### Section: `3) Results`
- **Results list (left panel)**
  - Detection class names + confidence percentages
- **Raw JSON panel (right panel)**
  - Full backend response body from `/detect`

---

## 2) Video page (`/videos.html`)

### Header
- **Status badge** (`Idle`, `Ready`, `Detecting…`, `Done`, `Error`)
- **Images link**
  - Navigates back to image page (`/`)

### Section: `1) Choose video`
- **Drop zone + file input**
  - Click to open file picker
  - Drag & drop video
- **Confidence slider**
  - Sent as `conf` to `/detect-video`
- **Sample every N frames**
  - Sent as `stride` to `/detect-video`
- **Max sampled frames**
  - Sent as `max_frames` to `/detect-video`
- **Detect Video button**
  - Disabled until a video is selected
  - Sends `POST /detect-video` multipart request

### Section: `2) Preview`
- **Video player**
  - Native playback controls
- **Overlay canvas**
  - Draws detections for selected sampled frame over video image

### Section: `3) Results`
- **Sample rows (left panel)**
  - One row per sampled timestamp/frame
  - Shows timestamp and box count
  - Click a row to:
    1. seek video to that sample timestamp
    2. draw that sample’s rectangles/labels on overlay canvas
  - First row is auto-selected after detection completes
- **Raw JSON panel (right panel)**
  - Full `/detect-video` response payload

---

## Common interaction behavior

- If backend request fails, status switches to `Error` and results panel shows failure info.
- Both pages display backend base URL text to reduce misconfiguration confusion during local setup.
- Navigation links are intentionally simple page links (no SPA router dependency).
