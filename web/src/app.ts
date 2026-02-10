import './style.css'

export type DetBox = { name: string; score: number; xyxy: number[] }
export type DetectResponse = { count: number; boxes: DetBox[] }

type DrawBox = DetBox & { _i: number }

export type AppOptions = {
  apiBase?: string
}

export function initApp(root: HTMLElement, opts: AppOptions = {}) {
  const API_BASE = opts.apiBase ?? '/api'

  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title">
        <h1>AI Image Recognition</h1>
        <p>Upload, drag-drop, or <b>Ctrl+V paste</b> an image → YOLO detects objects</p>
        <div class="pageLinks"><a href="#/videos">Videos</a></div>
      </div>

      <div class="status" id="status" data-state="idle">
        <span class="dot"></span>
        <span class="statusText">Idle</span>
      </div>
    </header>

    <main class="grid">
      <section class="card">
        <h2>1) Choose image</h2>

        <div class="drop" id="drop">
          <input id="file" type="file" accept="image/*" />
          <div class="dropInner">
            <div class="dropTitle">Drag & drop an image here</div>
            <div class="dropSub">…or click to select a file</div>
          </div>
        </div>

        <div class="controls">
          <label class="field">
            <span>Confidence</span>
            <input id="conf" type="range" min="0" max="1" step="0.01" value="0.25" />
            <span class="mono" id="confVal">0.25</span>
          </label>

          <button id="run" class="btn" disabled>Detect</button>
        </div>

        <div class="hint mono">Tip: paste images with <b>Ctrl+V</b>. Backend: <span id="backendUrl">${API_BASE}</span></div>
      </section>

      <section class="card">
        <h2>2) Preview</h2>
        <div class="canvasWrap">
          <canvas id="canvas"></canvas>
          <div class="empty" id="empty">No image selected</div>
        </div>
      </section>

      <section class="card span2">
        <h2>3) Results</h2>
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
  const confEl = root.querySelector<HTMLInputElement>('#conf')!
  const confValEl = root.querySelector<HTMLSpanElement>('#confVal')!
  const runEl = root.querySelector<HTMLButtonElement>('#run')!
  const statusEl = root.querySelector<HTMLDivElement>('#status')!
  const statusTextEl = statusEl.querySelector<HTMLSpanElement>('.statusText')!
  const canvas = root.querySelector<HTMLCanvasElement>('#canvas')!
  const emptyEl = root.querySelector<HTMLDivElement>('#empty')!
  const listEl = root.querySelector<HTMLDivElement>('#list')!
  const rawEl = root.querySelector<HTMLPreElement>('#raw')!
  const ctx = canvas.getContext('2d')!

  let currentFile: File | null = null
  let currentImg: HTMLImageElement | null = null
  let currentBoxes: DrawBox[] = []
  let hoveredBoxIndex = -1

  function setStatus(state: 'idle' | 'loading' | 'ok' | 'error', text: string) {
    statusEl.dataset.state = state
    statusTextEl.textContent = text
  }

  function setStatusTemp(text: string, ms = 1500) {
    const prev = statusTextEl.textContent || 'Ready'
    setStatus('ok', text)
    window.setTimeout(() => setStatus('idle', prev), ms)
  }

  function clamp(n: number, a: number, b: number) {
    return Math.max(a, Math.min(b, n))
  }

  function setCanvasToImage(img: HTMLImageElement) {
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
  }

  function drawBoxes(img: HTMLImageElement, boxes: DetBox[]) {
    currentBoxes = boxes.map((b, i) => ({ ...b, _i: i }))
    setCanvasToImage(img)

    const baseLineWidth = Math.max(3, Math.round(canvas.width / 320))
    const fontPx = Math.max(14, Math.round(canvas.width / 55))
    ctx.font = `${fontPx}px system-ui`

    for (const b of currentBoxes) {
      const [x1, y1, x2, y2] = b.xyxy
      const w = x2 - x1
      const h = y2 - y1
      const isHovered = hoveredBoxIndex === b._i

      ctx.lineWidth = isHovered ? baseLineWidth + 2 : baseLineWidth
      ctx.strokeStyle = '#ffeb3b'
      if (isHovered) {
        ctx.shadowColor = '#ffeb3b'
        ctx.shadowBlur = 14
      } else {
        ctx.shadowBlur = 0
      }
      ctx.strokeRect(x1, y1, w, h)
      ctx.shadowBlur = 0

      const label = `${b.name} ${(b.score * 100).toFixed(1)}%`
      const padX = 8
      const padY = 4
      const textW = ctx.measureText(label).width
      const boxH = fontPx + padY * 2

      const bx = x1
      const by = clamp(y1 - boxH - 2, 0, canvas.height - boxH)

      ctx.fillStyle = '#ffeb3b'
      ctx.fillRect(bx, by, textW + padX * 2, boxH)
      ctx.strokeStyle = isHovered ? '#fff68c' : '#ffeb3b'
      ctx.lineWidth = isHovered ? 2 : 1
      ctx.strokeRect(bx, by, textW + padX * 2, boxH)

      ctx.fillStyle = '#111'
      ctx.fillText(label, bx + padX, by + boxH - padY)
    }
  }

  function redraw() {
    if (!currentImg) return
    if (!currentBoxes.length) {
      setCanvasToImage(currentImg)
      return
    }
    drawBoxes(currentImg, currentBoxes)
  }

  function escapeHtml(s: string) {
    return s.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        case "'":
          return '&#39;'
        default:
          return c
      }
    })
  }

  function renderList(resp: DetectResponse) {
    if (!resp.boxes?.length) {
      listEl.innerHTML = `<div class="muted">No detections.</div>`
      return
    }

    const sorted = [...resp.boxes].sort((a, b) => b.score - a.score)

    listEl.innerHTML = sorted
      .map((b) => {
        const pct = (b.score * 100).toFixed(1)
        return `
        <div class="row">
          <div class="name">${escapeHtml(b.name)}</div>
          <div class="score mono">${pct}%</div>
        </div>
      `
      })
      .join('')
  }

  async function loadImageFromFile(f: File) {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.src = url
    await img.decode()
    URL.revokeObjectURL(url)
    return img
  }

  async function runDetect() {
    if (!currentFile || !currentImg) return

    setStatus('loading', 'Detecting…')
    runEl.disabled = true

    try {
      const conf = Number(confEl.value || '0.25')
      const fd = new FormData()
      fd.append('file', currentFile)

      const res = await fetch(`${API_BASE}/detect?conf=${encodeURIComponent(conf)}`, {
        method: 'POST',
        body: fd,
      })

      if (!res.ok) {
        const t = await res.text()
        throw new Error(`HTTP ${res.status}: ${t}`)
      }

      const json = (await res.json()) as DetectResponse

      rawEl.textContent = JSON.stringify(json, null, 2)
      renderList(json)
      hoveredBoxIndex = -1
      drawBoxes(currentImg, json.boxes || [])

      setStatus('ok', `Done (${json.count ?? 0} detections)`)
    } catch (e) {
      rawEl.textContent = String(e)
      listEl.innerHTML = `<div class="muted">Failed. Is the backend running at ${API_BASE}?</div>`
      setStatus('error', 'Error')
    } finally {
      runEl.disabled = !currentFile
    }
  }

  function onPickFile(f: File) {
    currentFile = f
    runEl.disabled = false
    setStatus('idle', 'Ready')

    emptyEl.style.display = 'none'
    rawEl.textContent = '{}'
    listEl.innerHTML = `<div class="muted">No detections yet.</div>`
    currentBoxes = []
    hoveredBoxIndex = -1

    loadImageFromFile(f)
      .then((img) => {
        currentImg = img
        setCanvasToImage(img)
      })
      .catch(() => {
        currentImg = null
        emptyEl.style.display = 'block'
        setStatus('error', 'Could not load image')
        runEl.disabled = true
      })
  }

  function fileFromClipboardItem(item: any): File | null {
    if (!item || item.kind !== 'file') return null
    const f = item.getAsFile?.() as File | null
    if (!f) return null
    if (!f.type?.startsWith('image/')) return null
    return f
  }

  function findHoveredBox(clientX: number, clientY: number): number {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return -1
    const x = ((clientX - rect.left) / rect.width) * canvas.width
    const y = ((clientY - rect.top) / rect.height) * canvas.height

    for (const b of currentBoxes) {
      const [x1, y1, x2, y2] = b.xyxy
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return b._i
    }
    return -1
  }

  // confidence UI
  confValEl.textContent = Number(confEl.value).toFixed(2)
  confEl.addEventListener('input', () => {
    confValEl.textContent = Number(confEl.value).toFixed(2)
  })

  // file input
  fileEl.addEventListener('change', () => {
    const f = fileEl.files?.[0] || null
    if (f) onPickFile(f)
  })

  // drag & drop
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

  canvas.addEventListener('mousemove', (e) => {
    const next = findHoveredBox(e.clientX, e.clientY)
    if (next === hoveredBoxIndex) return
    hoveredBoxIndex = next
    canvas.style.cursor = hoveredBoxIndex === -1 ? 'default' : 'pointer'
    redraw()
  })
  canvas.addEventListener('mouseleave', () => {
    if (hoveredBoxIndex === -1) return
    hoveredBoxIndex = -1
    canvas.style.cursor = 'default'
    redraw()
  })

  // Ctrl+V paste
  window.addEventListener('paste', (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    for (const it of Array.from(items as any)) {
      const f = fileFromClipboardItem(it)
      if (f) {
        const named = new File([f], `clipboard_${Date.now()}.png`, { type: f.type || 'image/png' })
        onPickFile(named)
        setStatusTemp('Pasted image from clipboard')
        e.preventDefault()
        return
      }
    }
  })

  runEl.addEventListener('click', () => runDetect())

  setStatus('idle', 'Idle')
  listEl.innerHTML = `<div class="muted">No detections yet.</div>`

  return {
    onPickFile,
    runDetect,
  }
}