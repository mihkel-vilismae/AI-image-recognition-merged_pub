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
    onUpdate(`Signaling server not found at ws://${host}:${DEFAULT_SIGNALING_PORT} yet. Waiting for a reachable signaling endpoint.`)
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
    onUpdate(`Signaling server not found at ws://${host}:${DEFAULT_SIGNALING_PORT} yet. Waiting for a reachable signaling endpoint.`)
  }, 2500)

  ws.addEventListener('open', () => {
    if (finished) return
    onUpdate('Signaling server found and reachable. Listening for incoming stream offer messages.')
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
      onUpdate('Video stream found: received a signaling message that indicates a video offer/track is available.')
      try {
        ws.close()
      } catch {}
    }
  })

  ws.addEventListener('error', () => {
    if (finished) return
    finished = true
    window.clearTimeout(timeout)
    onUpdate(`Signaling server not found at ws://${host}:${DEFAULT_SIGNALING_PORT} yet. Waiting for a reachable signaling endpoint.`)
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
          <div id="cameraStreamStatus" class="hint mono">Idle. Select a target host and run /health check or subnet scan to discover an active server.</div>
          <div id="cameraSignalStatus" class="hint mono">Signaling status: not checked yet. No WebRTC signaling probe has been executed.</div>
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
    statusEl.textContent = 'Checking selected host /health endpoint. Verifying server reachability and response payload…'
    const health = await checkServerHealth(host)

    if (health.ok) {
      ownUrlEl.value = buildOwnDetectUrlFromHost(host)
      statusEl.textContent = health.verified ? 'Own server health check passed. The selected host is responding with a valid health payload.' : 'Server is reachable, but health verification is CORS-limited (opaque/no-cors response). Please verify from the server side if needed.'
      setScanIndicator(scanIndicatorEl, 'found')
      refreshSignalingStatus()
      return
    }

    statusEl.textContent = 'Own server health check failed. Could not verify a healthy server at the selected host.'
    setScanIndicator(scanIndicatorEl, 'failed')
  })

  btnScanEl.addEventListener('click', async () => {
    const seedHost = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    setScanIndicator(scanIndicatorEl, 'searching')
    statusEl.textContent = 'Scanning local subnet for an available server. This can take a few seconds while hosts are probed…'
    const found = await scanSubnetForServer(seedHost)

    if (!found) {
      statusEl.textContent = 'Local network scan finished without finding a reachable server endpoint.'
      setScanIndicator(scanIndicatorEl, 'failed')
      return
    }

    ownUrlEl.value = buildOwnDetectUrlFromHost(found.host)
    statusEl.textContent = found.health.verified ? 'Own server found on the local network and health endpoint verified successfully.' : 'Potential server found on the local network, but health verification is CORS-limited.'
    setScanIndicator(scanIndicatorEl, 'found')
    refreshSignalingStatus()
  })

  setScanIndicator(scanIndicatorEl, 'idle')
  refreshSignalingStatus()
}
