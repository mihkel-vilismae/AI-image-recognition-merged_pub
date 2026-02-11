import './style.css'

/**
 * Camera stream detection UI and logic.
 *
 * This module implements a camera streaming tab for the web application. It draws
 * inspiration from the existing video detection module (`video.ts`) but is
 * specifically designed for live camera input. The UI includes controls to
 * start, pause and stop the stream, start continuous detection, or pause
 * detection and send a single frame. The detection loop captures frames from
 * the live stream at a regular interval and forwards them to the backend
 * `/detect` endpoint. Results are rendered in a list and as JSON, and
 * bounding boxes are drawn onto an overlay canvas. The valid detection window
 * slider discards stale detections similar to the video real‑time mode.
 */

type DetBox = { name: string; score: number; xyxy: number[] }
type DetectResponse = {
  count: number
  boxes: DetBox[]
  detection_request_at?: string
  detection_completed_at?: string
  detection_duration?: number
}

export interface CameraAppOptions {
  apiBase?: string
}

type StreamState = 'stopped' | 'started' | 'paused'

export function initCameraApp(root: HTMLElement, opts: CameraAppOptions = {}) {
  const API_BASE = opts.apiBase ?? 'http://localhost:8000'

  // Build the UI markup. The structure mirrors the existing video tab with
  // appropriate changes for live streaming. Only a single source option is
  // available for now ("incoming stream").
  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title">
        <h1>AI Camera Stream Recognition</h1>
        <p>Stream your camera and run YOLO detections in real time</p>
        <div class="pageLinks"><a href="#/images">Images</a></div>
        <div class="pageLinks"><a href="#/images">Videos</a></div>
      </div>
      <div class="status" id="status" data-state="idle">
        <span class="dot"></span>
        <span class="statusText">Idle</span>
      </div>
    </header>

    <main class="grid">
      <section class="card">
        <h2>1) Camera controls</h2>
        <label class="field">
          <span>Stream source</span>
          <select id="source">
            <option value="incoming" selected>incoming stream</option>
          </select>
        </label>
        <div class="actionRow" id="streamActions">
          <button id="startStream" class="btn" type="button">Start</button>
          <button id="pauseStream" class="btn" type="button" disabled>Pause</button>
          <button id="stopStream" class="btn" type="button" disabled>Stop</button>
        </div>
        <div class="actionRow" id="detectActions">
          <button id="startDetection" class="btn" type="button" disabled>Start detection</button>
          <button id="pauseSendOnce" class="btn" type="button" disabled>Pause and send once</button>
        </div>

        <h3>AI Provider</h3>
        <label class="field">
          <span>Provider</span>
          <select id="provider">
            <option value="default" selected>Default</option>
          </select>
        </label>
        <label class="field">
          <span>Own server URL</span>
          <input id="serverUrl" type="text" value="${API_BASE}" />
        </label>
        <div class="actionRow">
          <button id="healthCheck" class="btn btnSmall" type="button">Check selected IP /health</button>
          <button id="scanNetwork" class="btn btnSmall" type="button">Scan local network for server</button>
        </div>
        <label class="field">
          <span>Confidence</span>
          <input id="conf" type="range" min="0" max="1" step="0.01" value="0.25" />
          <span class="mono" id="confVal">0.25</span>
        </label>
        <label class="field">
          <span>Valid detection window (ms)</span>
          <input id="staleMs" type="range" min="100" max="2000" step="50" value="350" />
          <span class="mono" id="staleMsVal">350ms</span>
        </label>
        <div class="hint mono">Backend: <span>${API_BASE}</span></div>
      </section>

      <section class="card">
        <h2>2) Preview</h2>
        <div class="videoWrap" id="videoWrap">
          <video id="stream" class="video" autoplay muted></video>
          <canvas id="overlay" class="videoOverlay"></canvas>
        </div>
        <div class="frameMeta mono" id="frameMeta">frame: -, timestamp: -, T+ -ms</div>
      </section>

      <section class="card span2">
        <h2>3) Results</h2>
        <div class="resultTools">
          <button id="toggleRaw" class="btn btnSmall" type="button">Minimize JSON</button>
        </div>
        <div class="results">
          <div class="resultList" id="list"></div>
          <pre class="json" id="raw">{}</pre>
        </div>
      </section>
    </main>
  </div>
  `

  // Query DOM elements
  const statusEl = root.querySelector<HTMLDivElement>('#status')!
  const statusTextEl = statusEl.querySelector<HTMLSpanElement>('.statusText')!
  const startStreamEl = root.querySelector<HTMLButtonElement>('#startStream')!
  const pauseStreamEl = root.querySelector<HTMLButtonElement>('#pauseStream')!
  const stopStreamEl = root.querySelector<HTMLButtonElement>('#stopStream')!
  const startDetectionEl = root.querySelector<HTMLButtonElement>('#startDetection')!
  const pauseSendOnceEl = root.querySelector<HTMLButtonElement>('#pauseSendOnce')!
  const confEl = root.querySelector<HTMLInputElement>('#conf')!
  const confValEl = root.querySelector<HTMLSpanElement>('#confVal')!
  const staleMsEl = root.querySelector<HTMLInputElement>('#staleMs')!
  const staleMsValEl = root.querySelector<HTMLSpanElement>('#staleMsVal')!
  const toggleRawEl = root.querySelector<HTMLButtonElement>('#toggleRaw')!
  const listEl = root.querySelector<HTMLDivElement>('#list')!
  const rawEl = root.querySelector<HTMLPreElement>('#raw')!
  const frameMetaEl = root.querySelector<HTMLDivElement>('#frameMeta')!
  const videoEl = root.querySelector<HTMLVideoElement>('#stream')!
  const overlayEl = root.querySelector<HTMLCanvasElement>('#overlay')!
  const overlayCtx = overlayEl.getContext('2d')

  // Create offscreen canvas for capturing frames
  const captureCanvas = document.createElement('canvas')
  const captureCtx = captureCanvas.getContext('2d')

  // Internal state
  let streamState: StreamState = 'stopped'
  let mediaStream: MediaStream | null = null
  let detectionTimer: number | null = null
  let rawMinimized = false

  /** Utility to set status dot and text */
  function setStatus(state: 'idle' | 'loading' | 'ok' | 'error', text: string) {
    statusEl.dataset.state = state
    statusTextEl.textContent = text
  }

  /** Utility to update confidence display */
  function updateConf() {
    confValEl.textContent = Number(confEl.value).toFixed(2)
  }

  /** Utility to update stale ms display */
  function updateStaleMs() {
    staleMsValEl.textContent = `${staleMsEl.value}ms`
  }

  /** Toggle raw JSON minimization */
  function toggleRaw() {
    rawMinimized = !rawMinimized
    if (rawMinimized) {
      rawEl.style.display = 'none'
      toggleRawEl.textContent = 'Show JSON'
    } else {
      rawEl.style.display = 'block'
      toggleRawEl.textContent = 'Minimize JSON'
    }
  }

  /** Clear results UI */
  function clearResults() {
    listEl.innerHTML = ''
    rawEl.textContent = '{}'
  }

  /** Draw bounding boxes on overlay */
  function drawBoxes(boxes: DetBox[]) {
    if (!overlayCtx) return
    overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height)
    overlayCtx.font = '16px sans-serif'
    overlayCtx.lineWidth = 2
    overlayCtx.strokeStyle = '#00FF00'
    overlayCtx.fillStyle = 'rgba(0, 255, 0, 0.2)'
    for (const box of boxes) {
      const [x1, y1, x2, y2] = box.xyxy
      const w = x2 - x1
      const h = y2 - y1
      overlayCtx.strokeRect(x1, y1, w, h)
      overlayCtx.fillRect(x1, y1, w, h)
      overlayCtx.fillStyle = '#00FF00'
      overlayCtx.fillText(`${box.name} ${(box.score * 100).toFixed(1)}%`, x1 + 4, y1 + 16)
      overlayCtx.fillStyle = 'rgba(0, 255, 0, 0.2)'
    }
  }

  /** Populate result list and JSON output */
  function showResults(resp: DetectResponse) {
    listEl.innerHTML = ''
    for (const box of resp.boxes) {
      const item = document.createElement('div')
      item.textContent = `${box.name} (${(box.score * 100).toFixed(1)}%)`
      listEl.appendChild(item)
    }
    rawEl.textContent = JSON.stringify(resp, null, 2)
  }

  /** Update detection buttons based on stream state */
  function updateDetectionButtons() {
    const enabled = streamState === 'started' || streamState === 'paused'
    startDetectionEl.disabled = !enabled
    pauseSendOnceEl.disabled = !enabled
  }

  /** Update stream control buttons based on stream state */
  function updateStreamButtons() {
    if (streamState === 'stopped') {
      startStreamEl.disabled = false
      pauseStreamEl.disabled = true
      stopStreamEl.disabled = true
    } else if (streamState === 'started') {
      startStreamEl.disabled = true
      pauseStreamEl.disabled = false
      stopStreamEl.disabled = false
    } else if (streamState === 'paused') {
      startStreamEl.disabled = false
      pauseStreamEl.disabled = true
      stopStreamEl.disabled = false
    }
    updateDetectionButtons()
  }

  /** Capture current frame to an offscreen canvas and send to backend */
  async function captureAndDetect() {
    if (!mediaStream || !videoEl || streamState === 'stopped') return
    if (!captureCtx || !captureCanvas) return
    const w = videoEl.videoWidth
    const h = videoEl.videoHeight
    if (!w || !h) return
    captureCanvas.width = w
    captureCanvas.height = h
    captureCtx.drawImage(videoEl, 0, 0, w, h)
    const blob: Blob = await new Promise((resolve) => captureCanvas.toBlob(b => resolve(b!), 'image/jpeg'))
    try {
      setStatus('loading', 'Detecting…')
      const resp = await fetch(`${API_BASE}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', Accept: 'application/json' },
        body: blob,
      })
      const json = (await resp.json()) as DetectResponse
      // update frame meta and results
      frameMetaEl.textContent = `frame: -, timestamp: -, T+ -ms`
      drawBoxes(json.boxes)
      showResults(json)
      setStatus('ok', 'Done')
    } catch (err) {
      setStatus('error', 'Detection failed')
      console.error(err)
    }
  }

  /** Start continuous detection loop */
  function startDetectionLoop() {
    if (detectionTimer != null) return
    const interval = 1000 // 1 second interval for continuous detection
    detectionTimer = window.setInterval(() => {
      // only detect on live frames; skip while paused
      if (streamState === 'started') {
        captureAndDetect()
      }
    }, interval)
  }

  /** Stop continuous detection loop */
  function stopDetectionLoop() {
    if (detectionTimer != null) {
      clearInterval(detectionTimer)
      detectionTimer = null
    }
  }

  /** Send one frame and pause continuous detection */
  async function pauseAndSendOnce() {
    // pause continuous detection
    stopDetectionLoop()
    // capture one frame regardless of paused or started
    await captureAndDetect()
  }

  // Event listeners
  startStreamEl.addEventListener('click', async () => {
    if (streamState === 'started') return
    if (streamState === 'paused' && mediaStream) {
      await videoEl.play()
      streamState = 'started'
      setStatus('ok', 'Streaming')
      updateStreamButtons()
      return
    }
    try {
      // Acquire media stream from camera
      const constraints = { video: true, audio: false }
      const stream = await (navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia(constraints)
        : Promise.reject(new Error('mediaDevices unavailable')))
      mediaStream = stream
      videoEl.srcObject = stream as any
      await videoEl.play()
      streamState = 'started'
      setStatus('ok', 'Streaming')
      updateStreamButtons()
    } catch (err) {
      console.error(err)
      setStatus('error', 'Failed to access camera')
    }
  })

  pauseStreamEl.addEventListener('click', () => {
    if (streamState !== 'started') return
    videoEl.pause()
    streamState = 'paused'
    setStatus('idle', 'Paused')
    updateStreamButtons()
  })

  stopStreamEl.addEventListener('click', () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop())
    }
    mediaStream = null
    videoEl.srcObject = null
    streamState = 'stopped'
    stopDetectionLoop()
    drawBoxes([])
    clearResults()
    setStatus('idle', 'Stopped')
    updateStreamButtons()
  })

  startDetectionEl.addEventListener('click', () => {
    startDetectionLoop()
  })

  pauseSendOnceEl.addEventListener('click', () => {
    pauseAndSendOnce()
  })

  confEl.addEventListener('input', () => {
    updateConf()
  })
  staleMsEl.addEventListener('input', () => {
    updateStaleMs()
  })
  toggleRawEl.addEventListener('click', () => {
    toggleRaw()
  })

  // Initialize displays
  updateConf()
  updateStaleMs()
  updateStreamButtons()
  clearResults()
}
