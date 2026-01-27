# AI Image Recognition

Local (Windows-friendly) project: **FastAPI + Ultralytics YOLOv8** backend, and a **Vite + TypeScript** frontend.

## What you can do
- Upload an image and get YOLO detections (boxes + class + confidence)
- Drag & drop an image
- **Paste an image with Ctrl+V** from clipboard
- View detections list + raw JSON

## Quick start

### 1) Backend (FastAPI)
From Git Bash (or PowerShell), with your Python venv activated:

```bash
cd server
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Health check:
- http://localhost:8000/health

### 2) Frontend (Vite)

```bash
cd web
npm install
npm run dev
```

Open:
- http://localhost:5173

## Tests

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

## Notes
- In production you can serve `web/dist` behind a reverse proxy, or teach FastAPI to serve static files.
- Tests avoid downloading YOLO weights by mocking the model.
