# AI Image Recognition

A local-first computer vision project built with:
- **Backend:** FastAPI + Ultralytics YOLOv8
- **Frontend:** Vite + TypeScript

It supports both **image detection** and **video sampled-frame detection** with a straightforward browser UI.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Repository Layout](#repository-layout)
5. [Prerequisites](#prerequisites)
6. [Backend Setup and Run](#backend-setup-and-run)
7. [Frontend Setup and Run](#frontend-setup-and-run)
8. [How to Use the UI](#how-to-use-the-ui)
9. [API Reference Docs](#api-reference-docs)
10. [UI Reference Docs](#ui-reference-docs)
11. [Testing](#testing)
12. [Troubleshooting](#troubleshooting)
13. [Notes for Production](#notes-for-production)

---

## Project Overview

This project is designed for practical local development and demo workflows:
- Upload an image and run YOLO detection
- Upload a video and run detection on sampled frames
- View result summaries plus raw JSON payloads
- Navigate between image and video pages

The backend exposes a small API surface (`/health`, `/detect`, `/detect-video`) while the frontend keeps interaction lightweight and explicit.

---

## Features

### Image workflow
- File picker + drag/drop + clipboard paste (`Ctrl+V`)
- Confidence control
- Bounding boxes + labels rendered on canvas
- Hover highlight for detection boxes
- Sorted result list and raw JSON response panel

### Video workflow
- File picker + drag/drop
- Confidence / stride / max sampled frames controls
- Sampled-frame detection API call
- Clickable sample rows
- Video seek + overlay rectangle rendering for each selected sample
- Raw JSON response panel

### Developer ergonomics
- CORS configured for local Vite ports
- Lazy model loading for easier testing
- Startup LAN URL logging to help same-network device access

---

## Architecture

### Backend (`server/`)
- FastAPI app in `server/app/main.py`
- Ultralytics YOLO model loaded lazily
- Endpoints:
  - `GET /health`
  - `POST /detect`
  - `POST /detect-video`

### Frontend (`web/`)
- Vite + TypeScript
- Two entry pages:
  - `index.html` → image UI
  - `videos.html` → video UI

---

## Repository Layout

```text
server/
  app/main.py
  tests/
web/
  index.html
  videos.html
  src/app.ts
  src/video.ts
  tests/
docs/
  server-endpoints.md
  web-interface.md
README.md
```

---

## Prerequisites

### Backend
- Python 3.10+
- pip

### Frontend
- Node.js (LTS recommended)
- npm

---

## Backend Setup and Run

From repository root:

```bash
cd server
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Expected startup behavior:
- Uvicorn binds on `0.0.0.0:8000`
- Server logs LAN-accessible URLs when discoverable

Quick check:
- `http://localhost:8000/health`

---

## Frontend Setup and Run

From repository root:

```bash
cd web
npm install
npm run dev
```

Default pages:
- Image page: `http://localhost:5173/`
- Video page: `http://localhost:5173/videos.html`

If Vite uses a different port (e.g., `5174`), use that port in URLs.

---

## How to Use the UI

### Image page
1. Open `/`
2. Select, drag/drop, or paste an image
3. Adjust confidence
4. Click **Detect**
5. Review boxes on preview canvas + results list + raw JSON

### Video page
1. Open `/videos.html`
2. Select or drag/drop a video
3. Adjust confidence, stride, and max sampled frames
4. Click **Detect Video**
5. Click sampled rows to seek and view corresponding overlay boxes

---

## API Reference Docs

Detailed endpoint definitions live here:
- [`docs/server-endpoints.md`](docs/server-endpoints.md)

---

## UI Reference Docs

Detailed control/button behavior lives here:
- [`docs/web-interface.md`](docs/web-interface.md)

---

## Testing

### Backend tests

```bash
cd server
python -m pip install -r requirements-dev.txt
pytest -q
```

### Frontend tests

```bash
cd web
npm test
```

---

## Troubleshooting

### 1) CORS error in browser
- Ensure backend is running on port `8000`
- Ensure frontend runs on allowed localhost dev port (`5173`/`5174`)

### 2) `detect-video` returns data but no boxes visible
- Use the video page sample rows: click a row to seek + draw overlays
- Confirm response `samples[].boxes` contains detections

### 3) YOLO weight download delay on first run
- First startup may download weights; subsequent runs use local cache

### 4) Missing dependencies while testing
- Install all backend/frontend dependencies before running tests
- Some environments may miss `httpx` for FastAPI test client

---

## Notes for Production

- In production, serve built frontend assets (`web/dist`) through a static host/reverse proxy.
- Tighten CORS policy to explicit production origins.
- Consider request size limits and authentication if exposed publicly.
- For heavy video workloads, consider asynchronous jobs/queue workers.
