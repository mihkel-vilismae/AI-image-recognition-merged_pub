import './tab-style.css'
import {
  buildOwnDetectUrlFromHost,
  checkServerHealth,
  DEFAULT_PC_IP,
  DEFAULT_SIGNALING_PORT,
  extractIpv4HostFromText,
  scanSubnetForServer,
} from './camera-stream-utils'

type DetectBox = { name?: string; score?: number; xyxy?: number[] }

type DetectApiResponse = {
  boxes?: DetectBox[]
}

function setScanIndicator(el: HTMLSpanElement, state: 'idle' | 'searching' | 'found' | 'failed') {
  el.classList.remove('idle', 'searching', 'found', 'failed')
  el.classList.add(state)
}

function parseSignalingTarget(input: string): { host: string; port: number } {
  const trimmed = (input || '').trim()
  if (!trimmed) return { host: DEFAULT_PC_IP, port: DEFAULT_SIGNALING_PORT }

  const withProtocol = trimmed.includes('://') ? trimmed : `ws://${trimmed}`
  try {
    const parsed = new URL(withProtocol)
    return {
      host: parsed.hostname || DEFAULT_PC_IP,
      port: Number(parsed.port || String(DEFAULT_SIGNALING_PORT)),
    }
  } catch {
    return { host: DEFAULT_PC_IP, port: DEFAULT_SIGNALING_PORT }
  }
}

function openSignalingSocket(host: string, port: number): WebSocket {
  return new WebSocket(`ws://${host}:${port}`)
}

export function mountCameraStreamTab(root: HTMLElement) {
  root.innerHTML = `
  <div class="page cameraStreamPage">
    <header class="header">
      <div class="title">
        <h1>Camera Stream</h1>
      </div>
    </header>
    <main class="grid">
      <section class="card span2">
        <p>hello camera stream</p>

        <div class="cameraStreamControls cameraSection">
          <div class="cameraStreamTopRow">
            <button id="btnCheckOwnHealth" class="btn" type="button">Check selected IP /health</button>
            <button id="btnScanOwnServer" class="btn" type="button">Scan local network for server</button>
            <span id="scanIndicator" class="scanDot idle" aria-label="scan state"></span>
          </div>

          <label class="cameraRow" for="cameraConf">
            <span>Confidence</span>
            <input id="cameraConf" type="range" min="0" max="1" step="0.01" value="0.25" />
            <span class="mono" id="cameraConfVal">0.25</span>
          </label>

          <label class="cameraRow" for="cameraWindowMs">
            <span>Valid detection window (ms)</span>
            <input id="cameraWindowMs" type="range" min="50" max="2000" step="10" value="350" />
            <span class="mono" id="cameraWindowVal">350ms</span>
          </label>

          <label class="field" for="ownUrl"><span>AI server /detect URL</span></label>
          <input id="ownUrl" class="mono" value="${buildOwnDetectUrlFromHost(DEFAULT_PC_IP)}" />
          <div id="cameraStreamStatus" class="hint mono">Idle. Health/scan controls only target the AI image recognition server endpoint.</div>
        </div>

        <div class="cameraStreamControls signalingSection">
          <label class="field" for="signalingTarget"><span>Signaling server (ip:port)</span></label>
          <input id="signalingTarget" class="mono" value="${DEFAULT_PC_IP}:${DEFAULT_SIGNALING_PORT}" />

          <div class="cameraStreamTopRow">
            <button id="btnDetectSignaling" class="btn" type="button">Detect signaling server</button>
            <span id="detectSignalingResult" class="hint mono"></span>
          </div>

          <div class="cameraStreamTopRow">
            <button id="btnConnectSignaling" class="btn" type="button">Connect to signaling server</button>
            <span id="connectSignalingResult" class="hint mono"></span>
          </div>

          <div class="cameraStreamTopRow">
            <button id="btnShowVideoStream" class="btn" type="button" disabled>Show video stream</button>
            <span id="showVideoResult" class="hint mono"></span>
          </div>
        </div>

        <div id="streamPanel" class="streamPanel hidden">
          <div class="videoWrap cameraPreviewWrap">
            <video id="streamVideo" class="video" autoplay muted playsinline></video>
            <canvas id="streamOverlay" class="videoOverlay"></canvas>
          </div>
          <div class="cameraStreamTopRow">
            <button id="btnRealtimeDetectStream" class="btn" type="button">Detect frames in real time</button>
            <span id="realtimeResult" class="hint mono"></span>
          </div>
        </div>
      </section>
    </main>
  </div>
  `

  const ownUrlEl = root.querySelector<HTMLInputElement>('#ownUrl')!
  const signalingTargetEl = root.querySelector<HTMLInputElement>('#signalingTarget')!
  const statusEl = root.querySelector<HTMLDivElement>('#cameraStreamStatus')!
  const btnCheckEl = root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!
  const btnScanEl = root.querySelector<HTMLButtonElement>('#btnScanOwnServer')!
  const scanIndicatorEl = root.querySelector<HTMLSpanElement>('#scanIndicator')!
  const confEl = root.querySelector<HTMLInputElement>('#cameraConf')!
  const confValEl = root.querySelector<HTMLSpanElement>('#cameraConfVal')!
  const windowEl = root.querySelector<HTMLInputElement>('#cameraWindowMs')!
  const windowValEl = root.querySelector<HTMLSpanElement>('#cameraWindowVal')!
  const btnDetectSignalingEl = root.querySelector<HTMLButtonElement>('#btnDetectSignaling')!
  const detectSignalingResultEl = root.querySelector<HTMLSpanElement>('#detectSignalingResult')!
  const btnConnectSignalingEl = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
  const connectSignalingResultEl = root.querySelector<HTMLSpanElement>('#connectSignalingResult')!
  const btnShowVideoStreamEl = root.querySelector<HTMLButtonElement>('#btnShowVideoStream')!
  const showVideoResultEl = root.querySelector<HTMLSpanElement>('#showVideoResult')!
  const streamPanelEl = root.querySelector<HTMLDivElement>('#streamPanel')!
  const streamVideoEl = root.querySelector<HTMLVideoElement>('#streamVideo')!
  const streamOverlayEl = root.querySelector<HTMLCanvasElement>('#streamOverlay')!
  const btnRealtimeDetectStreamEl = root.querySelector<HTMLButtonElement>('#btnRealtimeDetectStream')!
  const realtimeResultEl = root.querySelector<HTMLSpanElement>('#realtimeResult')!
  const overlayCtx = streamOverlayEl.getContext('2d')

  let connectedSocket: WebSocket | null = null
  let detectProbeSocket: WebSocket | null = null
  let detectProbeTimeout: number | null = null
  let connectStatusTimer: number | null = null
  let stream: MediaStream | null = null
  let detectTimer: number | null = null

  confEl.addEventListener('input', () => {
    confValEl.textContent = Number(confEl.value).toFixed(2)
  })

  windowEl.addEventListener('input', () => {
    windowValEl.textContent = `${Number(windowEl.value).toFixed(0)}ms`
  })

  function stopRealtimeDetect() {
    if (detectTimer != null) {
      window.clearInterval(detectTimer)
      detectTimer = null
    }
    btnRealtimeDetectStreamEl.textContent = 'Detect frames in real time'
    realtimeResultEl.textContent = ''
  }

  function drawBoxes(boxes: DetectBox[]) {
    if (!overlayCtx) return
    const w = streamVideoEl.videoWidth || streamVideoEl.clientWidth
    const h = streamVideoEl.videoHeight || streamVideoEl.clientHeight
    if (!w || !h) return

    if (streamOverlayEl.width !== w) streamOverlayEl.width = w
    if (streamOverlayEl.height !== h) streamOverlayEl.height = h

    overlayCtx.clearRect(0, 0, w, h)
    overlayCtx.lineWidth = 2
    overlayCtx.font = '12px system-ui'

    for (const box of boxes) {
      const xyxy = box.xyxy
      if (!xyxy || xyxy.length < 4) continue
      const [x1, y1, x2, y2] = xyxy
      overlayCtx.strokeStyle = '#ffeb3b'
      overlayCtx.strokeRect(x1, y1, x2 - x1, y2 - y1)
      const label = `${box.name ?? 'object'} ${((box.score ?? 0) * 100).toFixed(0)}%`
      overlayCtx.fillStyle = 'rgba(0,0,0,0.6)'
      overlayCtx.fillRect(x1, Math.max(0, y1 - 16), overlayCtx.measureText(label).width + 8, 16)
      overlayCtx.fillStyle = '#fff'
      overlayCtx.fillText(label, x1 + 4, Math.max(0, y1 - 4))
    }
  }

  async function detectOneFrame() {
    const conf = Number(confEl.value || '0.25')
    const w = streamVideoEl.videoWidth
    const h = streamVideoEl.videoHeight
    if (!w || !h) return

    const captureCanvas = document.createElement('canvas')
    captureCanvas.width = w
    captureCanvas.height = h
    const captureCtx = captureCanvas.getContext('2d')
    if (!captureCtx) return
    captureCtx.drawImage(streamVideoEl, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) => captureCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.8))
    if (!blob) return

    const fd = new FormData()
    fd.append('file', blob, 'stream-frame.jpg')

    const response = await fetch(`${ownUrlEl.value.trim().split('?')[0]}?conf=${encodeURIComponent(conf)}`, {
      method: 'POST',
      body: fd,
    })

    if (!response.ok) {
      realtimeResultEl.textContent = `Frame detect failed: HTTP ${response.status}`
      return
    }

    const data = (await response.json()) as DetectApiResponse
    const boxes = data.boxes ?? []
    drawBoxes(boxes)
    realtimeResultEl.textContent = `Realtime frame analyzed. Detected ${boxes.length} boxes from AI image recognition server.`
  }

  async function showVideoStream() {
    showVideoResultEl.textContent = ''
    if (!navigator.mediaDevices?.getUserMedia) {
      showVideoResultEl.textContent = 'Video stream error: getUserMedia is not available in this browser environment.'
      return
    }

    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      streamVideoEl.srcObject = stream
      await streamVideoEl.play()
      streamPanelEl.classList.remove('hidden')
      showVideoResultEl.textContent = 'Video stream started and is now displayed.'
    } catch (error) {
      showVideoResultEl.textContent = `Video stream error: ${String(error)}`
    }
  }

  function clearDetectProbe() {
    if (detectProbeTimeout != null) {
      window.clearTimeout(detectProbeTimeout)
      detectProbeTimeout = null
    }

    if (detectProbeSocket) {
      try {
        detectProbeSocket.close()
      } catch {}
      detectProbeSocket = null
    }
  }


  function clearConnectionState(opts: { preserveConnectMessage?: boolean } = {}) {
    stopRealtimeDetect()
    streamPanelEl.classList.add('hidden')

    if (connectStatusTimer != null) {
      window.clearTimeout(connectStatusTimer)
      connectStatusTimer = null
    }

    const socketToClose = connectedSocket
    connectedSocket = null
    if (socketToClose && socketToClose.readyState < WebSocket.CLOSING) {
      try {
        socketToClose.close()
      } catch {}
    }

    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
      streamVideoEl.srcObject = null
    }

    btnConnectSignalingEl.textContent = 'Connect to signaling server'
    if (!opts.preserveConnectMessage) {
      connectSignalingResultEl.textContent = ''
    }
    btnShowVideoStreamEl.disabled = true
    showVideoResultEl.textContent = ''
  }

  btnCheckEl.addEventListener('click', async () => {
    const host = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    setScanIndicator(scanIndicatorEl, 'searching')
    statusEl.textContent = 'Checking selected AI image recognition server /health endpoint. Verifying server reachability and response payload…'
    const health = await checkServerHealth(host)

    if (health.ok) {
      ownUrlEl.value = buildOwnDetectUrlFromHost(host)
      statusEl.textContent = health.verified
        ? 'AI image recognition server health check passed. The selected host is responding with a valid health payload.'
        : 'AI image recognition server is reachable, but health verification is CORS-limited (opaque/no-cors response).'
      setScanIndicator(scanIndicatorEl, 'found')
      return
    }

    statusEl.textContent = 'AI image recognition server health check failed. Could not verify a healthy server at the selected host.'
    setScanIndicator(scanIndicatorEl, 'failed')
  })

  btnScanEl.addEventListener('click', async () => {
    const seedHost = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    setScanIndicator(scanIndicatorEl, 'searching')
    statusEl.textContent = 'Scanning local subnet for an available AI image recognition server. This can take a few seconds while hosts are probed…'
    const found = await scanSubnetForServer(seedHost)

    if (!found) {
      statusEl.textContent = 'AI image recognition server scan finished without finding a reachable server endpoint.'
      setScanIndicator(scanIndicatorEl, 'failed')
      return
    }

    ownUrlEl.value = buildOwnDetectUrlFromHost(found.host)
    statusEl.textContent = found.health.verified
      ? 'AI image recognition server found on the local network and health endpoint verified successfully.'
      : 'Potential AI image recognition server found on the local network, but health verification is CORS-limited.'
    setScanIndicator(scanIndicatorEl, 'found')
  })

  btnDetectSignalingEl.addEventListener('click', () => {
    if (detectProbeSocket || detectSignalingResultEl.textContent) {
      clearDetectProbe()
      detectSignalingResultEl.textContent = ''
      return
    }

    const { host, port } = parseSignalingTarget(signalingTargetEl.value)
    detectSignalingResultEl.textContent = `Detecting signaling server at ws://${host}:${port}…`

    let done = false
    const socket = openSignalingSocket(host, port)
    detectProbeSocket = socket
    detectProbeTimeout = window.setTimeout(() => {
      if (done) return
      done = true
      detectSignalingResultEl.textContent = `No signaling server detected at ws://${host}:${port}.`
      clearDetectProbe()
    }, 2500)

    socket.addEventListener('open', () => {
      if (done) return
      done = true
      detectSignalingResultEl.textContent = `Signaling server detected at ws://${host}:${port}.`
      clearDetectProbe()
    })

    socket.addEventListener('error', () => {
      if (done) return
      done = true
      detectSignalingResultEl.textContent = `No signaling server detected at ws://${host}:${port}.`
      clearDetectProbe()
    })

    socket.addEventListener('close', () => {
      if (!done) return
      clearDetectProbe()
    })
  })


  btnConnectSignalingEl.addEventListener('click', () => {
    clearDetectProbe()
    if (connectedSocket) {
      clearConnectionState({ preserveConnectMessage: true })
      return
    }

    const { host, port } = parseSignalingTarget(signalingTargetEl.value)
    connectSignalingResultEl.textContent = `Connecting to signaling server at ws://${host}:${port}…`

    let observedAnyMessage = false
    const socket = openSignalingSocket(host, port)
    connectedSocket = socket

    socket.addEventListener('message', () => {
      observedAnyMessage = true
    })

    socket.addEventListener('open', () => {
      if (connectedSocket !== socket) return
      btnConnectSignalingEl.textContent = 'Disconnect from signaling server'

      connectStatusTimer = window.setTimeout(() => {
        if (connectedSocket !== socket) return
        connectSignalingResultEl.textContent = observedAnyMessage
          ? `Signaling connection is ok at ws://${host}:${port}. Other clients are likely already connected (messages observed).`
          : `Signaling connection is ok at ws://${host}:${port}. This appears to be the only connected client right now.`
        btnShowVideoStreamEl.disabled = false
      }, 800)
    })

    socket.addEventListener('close', () => {
      if (connectedSocket !== socket) return
      clearConnectionState()
    })

    socket.addEventListener('error', () => {
      if (connectedSocket !== socket) return
      connectSignalingResultEl.textContent = `Failed to connect to signaling server at ws://${host}:${port}.`
      clearConnectionState({ preserveConnectMessage: true })
    })
  })

  btnShowVideoStreamEl.addEventListener('click', () => {
    void showVideoStream()
  })

  btnRealtimeDetectStreamEl.addEventListener('click', () => {
    if (detectTimer != null) {
      stopRealtimeDetect()
      return
    }

    btnRealtimeDetectStreamEl.textContent = 'Stop realtime detection'
    detectTimer = window.setInterval(() => {
      void detectOneFrame().catch((error) => {
        realtimeResultEl.textContent = `Realtime frame detect failed: ${String(error)}`
      })
    }, 1000)
  })

  setScanIndicator(scanIndicatorEl, 'idle')
}
