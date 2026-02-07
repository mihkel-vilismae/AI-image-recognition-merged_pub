import './style.css'

type DetBox = { name: string; score: number; xyxy: number[] }
type VideoSample = {
  frame_index: number
  time_sec: number | null
  count: number
  boxes: DetBox[]
  detection_request_at?: string
  detection_completed_at?: string
  detection_duration?: number
}
type DetectVideoResponse = { frame_count: number; sampled_count: number; samples: VideoSample[] }
type DetectResponse = {
  count: number
  boxes: DetBox[]
  detection_request_at?: string
  detection_completed_at?: string
  detection_duration?: number
}

type VideoAppOptions = {
  apiBase?: string
}

type DetectMode = 'whole' | 'realtime'

type RealtimeFrameAnalysis = {
  frame_number: number
  source_time_sec: number
  detection_request_at: string
  detection_completed_at: string
  detection_duration: number
  stale_discarded: boolean
  count: number
}

export function initVideoApp(root: HTMLElement, opts: VideoAppOptions = {}) {
  const API_BASE = opts.apiBase ?? 'http://localhost:8000'

  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title">
        <h1>AI Video Recognition</h1>
        <p>Upload a video and run sampled YOLO detections across frames</p>
        <div class="pageLinks"><a href="#/images">Images</a></div>
      </div>

      <div class="status" id="status" data-state="idle">
        <span class="dot"></span>
        <span class="statusText">Idle</span>
      </div>
    </header>

    <main class="grid">
      <section class="card">
        <h2>1) Choose video</h2>

        <div class="drop" id="drop">
          <input id="file" type="file" accept="video/*" />
          <div class="dropInner">
            <div class="dropTitle">Drag & drop a video here</div>
            <div class="dropSub">…or click to select a file</div>
          </div>
        </div>

        <div class="controls col">
          <h3 id="modeHeading" class="modeHeading">Mode: detect whole video</h3>
          <div class="modeSwitch" role="group" aria-label="Detection mode">
            <button id="modeWhole" class="btn modeBtn active" type="button">Detect whole video</button>
            <button id="modeRealtime" class="btn modeBtn" type="button">Detect frames in real time</button>
          </div>

          <label class="field">
            <span>Confidence</span>
            <input id="conf" type="range" min="0" max="1" step="0.01" value="0.25" />
            <span class="mono" id="confVal">0.25</span>
          </label>

          <label class="field" id="strideField">
            <span>Sample every N frames</span>
            <input id="stride" type="number" min="1" value="15" />
          </label>

          <label class="field" id="maxFramesField">
            <span>Max sampled frames</span>
            <input id="maxFrames" type="number" min="1" value="20" />
          </label>

          <label class="field hidden" id="staleMsField">
            <span>Valid detection window (ms)</span>
            <input id="staleMs" type="range" min="100" max="2000" step="50" value="350" />
            <span class="mono" id="staleMsVal">350ms</span>
          </label>

          <div class="actionRow" id="wholeActions">
            <button id="run" class="btn" disabled>Detect Video</button>
            <button id="playOverlay" class="btn btnOverlay" disabled>Play video with overlay</button>
          </div>

          <div class="actionRow hidden" id="realtimeActions">
            <button id="startRealtime" class="btn btnOverlay" disabled>Start video and detect frames in real time</button>
          </div>
        </div>

        <div class="hint mono">Backend: <span>${API_BASE}</span></div>
      </section>

      <section class="card">
        <h2>2) Preview</h2>
        <div class="videoWrap" id="videoWrap">
          <video id="preview" controls class="video"></video>
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

  const fileEl = root.querySelector<HTMLInputElement>('#file')!
  const dropEl = root.querySelector<HTMLDivElement>('#drop')!
  const runEl = root.querySelector<HTMLButtonElement>('#run')!
  const playOverlayEl = root.querySelector<HTMLButtonElement>('#playOverlay')!
  const startRealtimeEl = root.querySelector<HTMLButtonElement>('#startRealtime')!
  const modeWholeEl = root.querySelector<HTMLButtonElement>('#modeWhole')!
  const modeRealtimeEl = root.querySelector<HTMLButtonElement>('#modeRealtime')!
  const modeHeadingEl = root.querySelector<HTMLHeadingElement>('#modeHeading')!
  const wholeActionsEl = root.querySelector<HTMLDivElement>('#wholeActions')!
  const realtimeActionsEl = root.querySelector<HTMLDivElement>('#realtimeActions')!
  const strideFieldEl = root.querySelector<HTMLLabelElement>('#strideField')!
  const maxFramesFieldEl = root.querySelector<HTMLLabelElement>('#maxFramesField')!
  const staleMsFieldEl = root.querySelector<HTMLLabelElement>('#staleMsField')!
  const staleMsEl = root.querySelector<HTMLInputElement>('#staleMs')!
  const staleMsValEl = root.querySelector<HTMLSpanElement>('#staleMsVal')!
  const confEl = root.querySelector<HTMLInputElement>('#conf')!
  const confValEl = root.querySelector<HTMLSpanElement>('#confVal')!
  const strideEl = root.querySelector<HTMLInputElement>('#stride')!
  const maxFramesEl = root.querySelector<HTMLInputElement>('#maxFrames')!
  const previewEl = root.querySelector<HTMLVideoElement>('#preview')!
  const overlayEl = root.querySelector<HTMLCanvasElement>('#overlay')!
  const listEl = root.querySelector<HTMLDivElement>('#list')!
  const rawEl = root.querySelector<HTMLPreElement>('#raw')!
  const frameMetaEl = root.querySelector<HTMLDivElement>('#frameMeta')!
  const toggleRawEl = root.querySelector<HTMLButtonElement>('#toggleRaw')!
  const statusEl = root.querySelector<HTMLDivElement>('#status')!
  const statusTextEl = statusEl.querySelector<HTMLSpanElement>('.statusText')!
  const overlayCtx = overlayEl.getContext('2d')

  const captureCanvas = document.createElement('canvas')
  const captureCtx = captureCanvas.getContext('2d')

  let currentFile: File | null = null
  let currentUrl: string | null = null
  let currentResponse: DetectVideoResponse | null = null
  let selectedSampleIndex = -1
  let overlayPlaybackActive = false
  let mode: DetectMode = 'whole'
  let realtimeTimer: number | null = null
  let realtimeInFlight = false
  let frameCounter = 0
  let rawMinimized = false
  let realtimeFrameLog: RealtimeFrameAnalysis[] = []

  function nowIso() {
    return new Date().toISOString()
  }

  function setStatus(state: 'idle' | 'loading' | 'ok' | 'error', text: string) {
    statusEl.dataset.state = state
    statusTextEl.textContent = text
  }

  function setRawPayload(payload: unknown) {
    if (payload && typeof payload === 'object' && 'samples' in (payload as Record<string, unknown>)) {
      const p = payload as DetectVideoResponse & Record<string, unknown>
      if (Array.isArray(p.samples) && p.samples.length > 100) {
        const truncated = {
          ...p,
          samples: p.samples.slice(0, 100),
          truncated: true,
          truncated_note: `Showing first 100 of ${p.samples.length} samples`,
        }
        rawEl.textContent = JSON.stringify(truncated, null, 2)
        return
      }
    }
    rawEl.textContent = JSON.stringify(payload, null, 2)
  }

  function setMode(next: DetectMode) {
    mode = next
    modeWholeEl.classList.toggle('active', next === 'whole')
    modeRealtimeEl.classList.toggle('active', next === 'realtime')

    const isWhole = next === 'whole'
    modeHeadingEl.textContent = isWhole ? 'Mode: detect whole video' : 'Mode: detect frames in real time'
    wholeActionsEl.classList.toggle('hidden', !isWhole)
    realtimeActionsEl.classList.toggle('hidden', isWhole)
    strideFieldEl.classList.toggle('hidden', !isWhole)
    maxFramesFieldEl.classList.toggle('hidden', !isWhole)
    staleMsFieldEl.classList.toggle('hidden', isWhole)
  }

  function setOverlayPlaybackArmed(isArmed: boolean) {
    playOverlayEl.disabled = !isArmed
    playOverlayEl.classList.toggle('armed', isArmed)
  }

  function setRealtimeArmed(isArmed: boolean) {
    startRealtimeEl.disabled = !isArmed
    startRealtimeEl.classList.toggle('armed', isArmed)
  }

  function clearOverlay() {
    if (!overlayCtx) return
    overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height)
  }

  function ensureOverlaySized() {
    if (!previewEl.videoWidth || !previewEl.videoHeight) return false
    if (overlayEl.width !== previewEl.videoWidth || overlayEl.height !== previewEl.videoHeight) {
      overlayEl.width = previewEl.videoWidth
      overlayEl.height = previewEl.videoHeight
    }
    return true
  }

  function drawBoxes(boxes: DetBox[]) {
    if (!overlayCtx || !ensureOverlaySized()) {
      return
    }

    clearOverlay()
    const baseLineWidth = Math.max(3, Math.round(overlayEl.width / 320))
    const fontPx = Math.max(14, Math.round(overlayEl.width / 55))
    overlayCtx.font = `${fontPx}px system-ui`
    overlayCtx.lineWidth = baseLineWidth

    for (const box of boxes) {
      const [x1, y1, x2, y2] = box.xyxy
      const w = x2 - x1
      const h = y2 - y1

      overlayCtx.strokeStyle = '#ffeb3b'
      overlayCtx.strokeRect(x1, y1, w, h)

      const label = `${box.name} ${(box.score * 100).toFixed(1)}%`
      const padX = 8
      const padY = 4
      const textW = overlayCtx.measureText(label).width
      const boxH = fontPx + padY * 2
      const by = Math.max(0, y1 - boxH - 2)

      overlayCtx.fillStyle = '#ffeb3b'
      overlayCtx.fillRect(x1, by, textW + padX * 2, boxH)
      overlayCtx.fillStyle = '#111'
      overlayCtx.fillText(label, x1 + padX, by + boxH - padY)
    }
  }

  function updateFrameMeta(frameNumber: number | string, timestamp: string, durationMs: number | string) {
    frameMetaEl.textContent = `frame: ${frameNumber}, timestamp: ${timestamp}, T+ ${durationMs}ms`
  }

  function drawSample(sample: VideoSample) {
    drawBoxes(sample.boxes)
    updateFrameMeta(sample.frame_index, sample.detection_completed_at ?? '-', sample.detection_duration ?? '-')
  }

  function markActiveRow(index: number) {
    selectedSampleIndex = index
    for (const row of listEl.querySelectorAll('.row')) {
      row.classList.remove('active')
    }
    listEl.querySelector<HTMLDivElement>(`.row[data-index="${index}"]`)?.classList.add('active')
  }

  function drawSampleAtIndex(index: number) {
    if (!currentResponse || index < 0 || index >= currentResponse.samples.length) return
    markActiveRow(index)
    drawSample(currentResponse.samples[index])
  }

  function selectSample(index: number) {
    if (!currentResponse || index < 0 || index >= currentResponse.samples.length) return

    overlayPlaybackActive = false
    const sample = currentResponse.samples[index]
    if (sample.time_sec == null) {
      drawSampleAtIndex(index)
      return
    }

    if (Math.abs(previewEl.currentTime - sample.time_sec) <= 0.03) {
      drawSampleAtIndex(index)
      return
    }

    const onSeeked = () => {
      previewEl.removeEventListener('seeked', onSeeked)
      drawSampleAtIndex(index)
    }
    previewEl.addEventListener('seeked', onSeeked)

    try {
      previewEl.pause()
    } catch {
      // no-op in environments with limited media support
    }
    previewEl.currentTime = sample.time_sec
  }

  function updateOverlayForPlayback(currentTime: number) {
    if (!currentResponse || currentResponse.samples.length === 0) return

    let index = -1
    for (let i = 0; i < currentResponse.samples.length; i += 1) {
      const sampleTime = currentResponse.samples[i].time_sec
      if (sampleTime == null) continue
      if (sampleTime <= currentTime + 0.03) {
        index = i
      } else {
        break
      }
    }

    if (index !== -1 && index !== selectedSampleIndex) {
      drawSampleAtIndex(index)
    }
  }

  function stopRealtimeMode() {
    if (realtimeTimer != null) {
      window.clearInterval(realtimeTimer)
      realtimeTimer = null
    }
    realtimeInFlight = false
    startRealtimeEl.textContent = 'Start video and detect frames in real time'
  }

  function onPickFile(file: File) {
    stopRealtimeMode()

    currentFile = file
    runEl.disabled = false
    setRealtimeArmed(true)
    setStatus('idle', 'Ready')
    rawEl.textContent = '{}'
    listEl.innerHTML = '<div class="muted">No detections yet.</div>'
    currentResponse = null
    selectedSampleIndex = -1
    overlayPlaybackActive = false
    frameCounter = 0
    realtimeFrameLog = []
    updateFrameMeta('-', '-', '-')
    setOverlayPlaybackArmed(false)
    clearOverlay()

    if (currentUrl) URL.revokeObjectURL(currentUrl)
    currentUrl = URL.createObjectURL(file)
    previewEl.src = currentUrl
  }

  function renderList(resp: DetectVideoResponse) {
    if (!resp.samples.length) {
      listEl.innerHTML = '<div class="muted">No sampled detections.</div>'
      return
    }

    listEl.innerHTML = resp.samples
      .map((sample, index) => {
        const label = sample.time_sec == null ? `Frame ${sample.frame_index}` : `${sample.time_sec.toFixed(2)}s`
        return `<div class="row selectable" data-index="${index}"><div class="name">${label}</div><div class="score mono">${sample.count} boxes</div></div>`
      })
      .join('')

    listEl.querySelectorAll<HTMLDivElement>('.row.selectable').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.index)
        selectSample(idx)
      })
    })
  }

  async function runDetectVideo() {
    if (!currentFile) return

    stopRealtimeMode()
    runEl.disabled = true
    setOverlayPlaybackArmed(false)
    overlayPlaybackActive = false
    setStatus('loading', 'Detecting…')

    try {
      const conf = Number(confEl.value || '0.25')
      const stride = Math.max(1, Number(strideEl.value || '15'))
      const maxFrames = Math.max(1, Number(maxFramesEl.value || '20'))
      const fd = new FormData()
      fd.append('file', currentFile)

      const response = await fetch(
        `${API_BASE}/detect-video?conf=${encodeURIComponent(conf)}&stride=${encodeURIComponent(stride)}&max_frames=${encodeURIComponent(maxFrames)}`,
        { method: 'POST', body: fd },
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      const json = (await response.json()) as DetectVideoResponse
      currentResponse = json
      setRawPayload(json)
      renderList(json)

      if (json.samples.length) {
        if (previewEl.readyState >= 1) {
          selectSample(0)
        } else {
          previewEl.addEventListener(
            'loadedmetadata',
            () => {
              selectSample(0)
            },
            { once: true },
          )
        }
        setOverlayPlaybackArmed(true)
      } else {
        clearOverlay()
      }

      setStatus('ok', `Done (${json.sampled_count} sampled)`)
    } catch (error) {
      rawEl.textContent = String(error)
      listEl.innerHTML = `<div class="muted">Failed. Is the backend running at ${API_BASE}?</div>`
      setStatus('error', 'Error')
      clearOverlay()
      setOverlayPlaybackArmed(false)
    } finally {
      runEl.disabled = !currentFile
    }
  }

  function playVideoWithOverlay() {
    if (!currentResponse || playOverlayEl.disabled) return

    stopRealtimeMode()
    overlayPlaybackActive = true
    selectedSampleIndex = -1
    previewEl.currentTime = 0

    try {
      const maybePromise = previewEl.play()
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          setStatus('error', 'Could not start playback')
        })
      }
    } catch {
      setStatus('error', 'Could not start playback')
    }

    updateOverlayForPlayback(0)
  }

  async function captureFrameBlob(): Promise<Blob | null> {
    if (!captureCtx) return null
    if (!previewEl.videoWidth || !previewEl.videoHeight) return null

    captureCanvas.width = previewEl.videoWidth
    captureCanvas.height = previewEl.videoHeight
    captureCtx.drawImage(previewEl, 0, 0, captureCanvas.width, captureCanvas.height)

    return await new Promise<Blob | null>((resolve) => {
      captureCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85)
    })
  }

  async function detectRealtimeFrame(requestedAtSec: number) {
    if (!currentFile || realtimeInFlight) return
    realtimeInFlight = true

    const requestAtIso = nowIso()
    const requestedAtMs = performance.now()
    const requestFrameNumber = frameCounter + 1

    try {
      const frameBlob = await captureFrameBlob()
      if (!frameBlob) return

      const conf = Number(confEl.value || '0.25')
      const fd = new FormData()
      fd.append('file', frameBlob, `frame_${Math.round(requestedAtSec * 1000)}.jpg`)

      const response = await fetch(`${API_BASE}/detect?conf=${encodeURIComponent(conf)}`, {
        method: 'POST',
        body: fd,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      const json = (await response.json()) as DetectResponse
      const completeAtIso = json.detection_completed_at ?? nowIso()
      const durationMs =
        typeof json.detection_duration === 'number'
          ? json.detection_duration
          : Math.round(performance.now() - requestedAtMs)

      const staleThresholdMs = Number(staleMsEl.value || '350')
      const stale = !overlayPlaybackActive || (previewEl.currentTime - requestedAtSec) * 1000 > staleThresholdMs

      frameCounter = requestFrameNumber
      realtimeFrameLog.push({
        frame_number: requestFrameNumber,
        source_time_sec: Number(requestedAtSec.toFixed(3)),
        detection_request_at: json.detection_request_at ?? requestAtIso,
        detection_completed_at: completeAtIso,
        detection_duration: durationMs,
        stale_discarded: stale,
        count: json.count ?? 0,
      })

      if (stale) {
        return
      }

      drawBoxes(json.boxes || [])
      updateFrameMeta(requestFrameNumber, completeAtIso, durationMs)
      appendRealtimeResultRow(requestedAtSec, json.count ?? 0)
      setRawPayload({
        mode: 'realtime',
        stale_threshold_ms: staleThresholdMs,
        analyzed_frames_count: realtimeFrameLog.length,
        analyzed_frames: realtimeFrameLog,
      })
      setStatus('ok', `Realtime frame ${requestFrameNumber} (${durationMs}ms)`)
    } catch (error) {
      setStatus('error', 'Realtime detect failed')
      rawEl.textContent = String(error)
    } finally {
      realtimeInFlight = false
    }
  }

  function startRealtimeDetect() {
    if (!currentFile || startRealtimeEl.disabled) return

    stopRealtimeMode()
    overlayPlaybackActive = true
    selectedSampleIndex = -1
    currentResponse = null
    frameCounter = 0
    realtimeFrameLog = []
    setOverlayPlaybackArmed(false)
    listEl.innerHTML = '<div class="muted">Realtime detection running…</div>'
    startRealtimeEl.textContent = 'Realtime detection running…'
    setStatus('loading', 'Detecting in real time…')

    previewEl.currentTime = 0
    try {
      const maybePromise = previewEl.play()
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          setStatus('error', 'Could not start playback')
        })
      }
    } catch {
      setStatus('error', 'Could not start playback')
    }

    realtimeTimer = window.setInterval(() => {
      if (!overlayPlaybackActive || previewEl.paused || previewEl.ended) return
      void detectRealtimeFrame(previewEl.currentTime)
    }, 250)
  }

  function appendRealtimeResultRow(timeSec: number, boxCount: number) {
    if (listEl.querySelector('.muted')) {
      listEl.innerHTML = ''
    }

    listEl.insertAdjacentHTML(
      'beforeend',
      `<div class="row"><div class="name">${timeSec.toFixed(2)}s</div><div class="score mono">${boxCount} boxes</div></div>`,
    )
  }

  confValEl.textContent = Number(confEl.value).toFixed(2)
  confEl.addEventListener('input', () => {
    confValEl.textContent = Number(confEl.value).toFixed(2)
  })

  staleMsValEl.textContent = `${Number(staleMsEl.value).toFixed(0)}ms`
  staleMsEl.addEventListener('input', () => {
    staleMsValEl.textContent = `${Number(staleMsEl.value).toFixed(0)}ms`
  })

  toggleRawEl.addEventListener('click', () => {
    rawMinimized = !rawMinimized
    rawEl.classList.toggle('hidden', rawMinimized)
    toggleRawEl.textContent = rawMinimized ? 'Maximize JSON' : 'Minimize JSON'
  })

  fileEl.addEventListener('change', () => {
    const f = fileEl.files?.[0]
    if (f) onPickFile(f)
  })

  dropEl.addEventListener('dragover', (e) => {
    e.preventDefault()
    dropEl.classList.add('drag')
  })
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag'))
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault()
    dropEl.classList.remove('drag')
    const f = (e as DragEvent).dataTransfer?.files?.[0]
    if (f) onPickFile(f)
  })

  modeWholeEl.addEventListener('click', () => {
    stopRealtimeMode()
    setMode('whole')
    setStatus('idle', 'Ready')
  })
  modeRealtimeEl.addEventListener('click', () => {
    stopRealtimeMode()
    setMode('realtime')
    setStatus('idle', 'Ready')
  })

  previewEl.addEventListener('timeupdate', () => {
    if (!overlayPlaybackActive) return
    if (mode === 'whole') {
      updateOverlayForPlayback(previewEl.currentTime)
    }
  })
  previewEl.addEventListener('ended', () => {
    overlayPlaybackActive = false
    stopRealtimeMode()
    setStatus('ok', 'Finished')
  })

  runEl.addEventListener('click', () => runDetectVideo())
  playOverlayEl.addEventListener('click', () => playVideoWithOverlay())
  startRealtimeEl.addEventListener('click', () => startRealtimeDetect())

  setMode('whole')
  setRealtimeArmed(false)
  updateFrameMeta('-', '-', '-')
  setStatus('idle', 'Idle')
  listEl.innerHTML = '<div class="muted">No detections yet.</div>'

  return { onPickFile, runDetectVideo, startRealtimeDetect }
}