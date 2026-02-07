import './tab-style.css'
import {
  buildOwnDetectUrlFromHost,
  checkServerHealth,
  DEFAULT_PC_IP,
  DEFAULT_SIGNALING_PORT,
  extractIpv4HostFromText,
  hasVideoStreamSignal,
  scanSubnetForServer,
} from './camera-stream-utils'

function setScanIndicator(el: HTMLSpanElement, state: 'idle' | 'searching' | 'found' | 'failed') {
  el.classList.remove('idle', 'searching', 'found', 'failed')
  el.classList.add(state)
}

function pollSignalingServer(host: string, onUpdate: (text: string) => void) {
  if (typeof WebSocket === 'undefined') {
    onUpdate('server not found')
    return
  }

  const ws = new WebSocket(`ws://${host}:${DEFAULT_SIGNALING_PORT}`)
  let finished = false
  const timeout = window.setTimeout(() => {
    if (finished) return
    finished = true
    try {
      ws.close()
    } catch {}
    onUpdate('server not found')
  }, 2500)

  ws.addEventListener('open', () => {
    if (finished) return
    onUpdate('server found')
  })

  ws.addEventListener('message', (event) => {
    if (finished) return

    let payload: unknown = event.data
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload)
      } catch {}
    }

    if (hasVideoStreamSignal(payload)) {
      finished = true
      window.clearTimeout(timeout)
      onUpdate('video stream found')
      try {
        ws.close()
      } catch {}
    }
  })

  ws.addEventListener('error', () => {
    if (finished) return
    finished = true
    window.clearTimeout(timeout)
    onUpdate('server not found')
  })

  ws.addEventListener('close', () => {
    if (finished) return
    finished = true
    window.clearTimeout(timeout)
  })
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
        <div class="cameraStreamControls">
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

          <input id="ownUrl" class="mono" value="${buildOwnDetectUrlFromHost(DEFAULT_PC_IP)}" />
          <div id="cameraStreamStatus" class="hint mono">Idle</div>
          <div id="cameraSignalStatus" class="hint mono">signaling: not checked</div>
        </div>
      </section>
    </main>
  </div>
  `

  const ownUrlEl = root.querySelector<HTMLInputElement>('#ownUrl')!
  const statusEl = root.querySelector<HTMLDivElement>('#cameraStreamStatus')!
  const signalStatusEl = root.querySelector<HTMLDivElement>('#cameraSignalStatus')!
  const btnCheckEl = root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!
  const btnScanEl = root.querySelector<HTMLButtonElement>('#btnScanOwnServer')!
  const scanIndicatorEl = root.querySelector<HTMLSpanElement>('#scanIndicator')!
  const confEl = root.querySelector<HTMLInputElement>('#cameraConf')!
  const confValEl = root.querySelector<HTMLSpanElement>('#cameraConfVal')!
  const windowEl = root.querySelector<HTMLInputElement>('#cameraWindowMs')!
  const windowValEl = root.querySelector<HTMLSpanElement>('#cameraWindowVal')!

  confEl.addEventListener('input', () => {
    confValEl.textContent = Number(confEl.value).toFixed(2)
  })

  windowEl.addEventListener('input', () => {
    windowValEl.textContent = `${Number(windowEl.value).toFixed(0)}ms`
  })

  function refreshSignalingStatus() {
    const host = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    pollSignalingServer(host, (text) => {
      signalStatusEl.textContent = text
    })
  }

  btnCheckEl.addEventListener('click', async () => {
    const host = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    setScanIndicator(scanIndicatorEl, 'searching')
    statusEl.textContent = 'Checking /health…'
    const health = await checkServerHealth(host)

    if (health.ok) {
      ownUrlEl.value = buildOwnDetectUrlFromHost(host)
      statusEl.textContent = health.verified ? 'own server health check passed' : 'server reachable (CORS-limited health)'
      setScanIndicator(scanIndicatorEl, 'found')
      refreshSignalingStatus()
      return
    }

    statusEl.textContent = 'own server health check failed'
    setScanIndicator(scanIndicatorEl, 'failed')
  })

  btnScanEl.addEventListener('click', async () => {
    const seedHost = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    setScanIndicator(scanIndicatorEl, 'searching')
    statusEl.textContent = 'Scanning local network…'
    const found = await scanSubnetForServer(seedHost)

    if (!found) {
      statusEl.textContent = 'own server scan failed'
      setScanIndicator(scanIndicatorEl, 'failed')
      return
    }

    ownUrlEl.value = buildOwnDetectUrlFromHost(found.host)
    statusEl.textContent = found.health.verified ? 'own server found' : 'server reachable (CORS-limited health)'
    setScanIndicator(scanIndicatorEl, 'found')
    refreshSignalingStatus()
  })

  setScanIndicator(scanIndicatorEl, 'idle')
  refreshSignalingStatus()
}
