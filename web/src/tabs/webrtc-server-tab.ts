import './tab-style.css'

import { onAppEvent } from '../common'

type StepId = 'relay' | 'phone' | 'connect' | 'show' | 'track'
type StepState = 'idle' | 'working' | 'ok' | 'fail'
type ComponentState = 'online' | 'stale' | 'offline'

type StepError = {
  message: string
  details?: unknown
  snapshot: Record<StepId, StepState>
  timestamp: string
}

type ResolvedConfig = {
  relayUrl: string
  relayHost: string
  relayPort: number
  source: 'query-relay' | 'query-ip' | 'storage' | 'hostname' | 'manual'
}

const RELAY_PATH = 'tools/webrtc-relay/server.py'
const RELAY_COMMANDS = ['cd tools/webrtc-relay', 'pip install websockets', 'python server.py']
const RELAY_CODE = `import asyncio
import contextlib
import websockets
from websockets.exceptions import ConnectionClosed

clients = set()


async def relay(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            for client in tuple(clients):
                if client is websocket:
                    continue
                with contextlib.suppress(Exception):
                    await client.send(message)
    except (ConnectionClosed, ConnectionResetError, OSError):
        pass
    finally:
        clients.discard(websocket)


async def main():
    async with websockets.serve(
        relay,
        "0.0.0.0",
        8765,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=2,
    ):
        print("WebSocket relay listening on ws://0.0.0.0:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
`

const STORAGE_RELAY_KEY = 'webrtc.lastGoodRelay'
const STORAGE_IP_KEY = 'webrtc.lastGoodIp'
const STEP_ORDER: StepId[] = ['relay', 'phone', 'connect', 'show', 'track']

function cloneSnapshot(states: Record<StepId, StepState>): Record<StepId, StepState> {
  return { ...states }
}

function isLoopbackHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

function isLikelyIpv4(input: string): boolean {
  const trimmed = input.trim()
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) return false
  return trimmed.split('.').every((segment) => {
    const value = Number(segment)
    return Number.isInteger(value) && value >= 0 && value <= 255
  })
}

function parseRelayUrl(input: string): { host: string; port: number } | null {
  const value = (input || '').trim()
  if (!value) return null
  try {
    const parsed = new URL(value.includes('://') ? value : `ws://${value}`)
    return { host: parsed.hostname, port: Number(parsed.port || '8765') }
  } catch {
    return null
  }
}

function resolveConfig(manualIp: string, mode: 'hostname' | 'manual'): ResolvedConfig {
  const params = new URLSearchParams(window.location.search)
  const relayParam = params.get('relay')?.trim() || ''
  const ipParam = params.get('ip')?.trim() || ''
  const storageRelay = localStorage.getItem(STORAGE_RELAY_KEY)?.trim() || ''
  const storageIp = localStorage.getItem(STORAGE_IP_KEY)?.trim() || ''
  const hostname = (window.location.hostname || '').trim()

  const parsedRelayParam = parseRelayUrl(relayParam)
  if (parsedRelayParam) {
    return {
      relayUrl: relayParam.includes('://') ? relayParam : `ws://${relayParam}`,
      relayHost: parsedRelayParam.host,
      relayPort: parsedRelayParam.port,
      source: 'query-relay',
    }
  }

  if (ipParam && isLikelyIpv4(ipParam)) {
    return {
      relayUrl: `ws://${ipParam}:8765`,
      relayHost: ipParam,
      relayPort: 8765,
      source: 'query-ip',
    }
  }

  const parsedStorageRelay = parseRelayUrl(storageRelay)
  if (parsedStorageRelay) {
    return {
      relayUrl: storageRelay,
      relayHost: parsedStorageRelay.host,
      relayPort: parsedStorageRelay.port,
      source: 'storage',
    }
  }

  if (storageIp && isLikelyIpv4(storageIp)) {
    return {
      relayUrl: `ws://${storageIp}:8765`,
      relayHost: storageIp,
      relayPort: 8765,
      source: 'storage',
    }
  }

  if (mode === 'manual' && isLikelyIpv4(manualIp)) {
    return {
      relayUrl: `ws://${manualIp}:8765`,
      relayHost: manualIp,
      relayPort: 8765,
      source: 'manual',
    }
  }

  if (hostname && !isLoopbackHost(hostname)) {
    return {
      relayUrl: `ws://${hostname}:8765`,
      relayHost: hostname,
      relayPort: 8765,
      source: 'hostname',
    }
  }

  return {
    relayUrl: '',
    relayHost: '',
    relayPort: 8765,
    source: 'manual',
  }
}

function makePhonePublisherHtml(ip: string) {
  const resolvedIp = ip || '__PC_LAN_IP__'
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phone Publisher</title>
</head>
<body>
<button id="btnStart">Start camera</button>
<pre id="log"></pre>
<pre id="error"></pre>
<script>
const SIGNALING_URL = "ws://${resolvedIp}:8765";
let pc, ws, stream;
const log = msg => document.getElementById("log").textContent += msg + "\\n";
const error = msg => document.getElementById("error").textContent += msg + "\\n";
document.getElementById("btnStart").onclick = async () => {
  try {
    ws = new WebSocket(SIGNALING_URL);
    ws.onopen = async () => {
      log("WS CONNECTED");
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      pc = new RTCPeerConnection();
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      pc.onicecandidate = e => e.candidate && ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
      log("Offer sent");
    };
    ws.onmessage = async e => {
      const msg = JSON.parse(e.data);
      if (msg.type === "answer") await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      if (msg.type === "candidate") await pc.addIceCandidate(msg.candidate);
    };
    ws.onerror = () => error("WebSocket error");
  } catch (e) {
    error(String(e));
  }
};
</script>
</body>
</html>`
}

export function mountWebrtcServerTab(root: HTMLElement) {
  root.innerHTML = `
  <div class="page cameraStreamPage">
    <header class="header">
      <div class="title">
        <h1>WebRTC Server</h1>
        <p>Phone camera publisher + signaling relay + camera-stream viewer wiring.</p>
      </div>
    </header>

    <main class="grid">
      <section class="card span2">
        <div id="systemPanel" class="systemPanel">
          <h2>System / Components</h2>
          <table class="systemTable mono">
            <tbody>
              <tr data-component="phone"><td>This device (phone publisher)</td><td data-field="ip">unknown</td><td data-field="port">browser</td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td></tr>
              <tr data-component="pc"><td>PC receiver</td><td data-field="ip">unknown</td><td data-field="port">camera-stream tab</td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td></tr>
              <tr data-component="relay"><td>WS signaling relay</td><td data-field="ip">unknown</td><td data-field="port">8765</td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td></tr>
              <tr data-component="backend"><td>Health endpoint</td><td data-field="ip">same-origin</td><td data-field="port">/api/health</td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td></tr>
            </tbody>
          </table>
          <div id="resolvedConfig" class="hint mono"></div>
        </div>

        <div class="webrtcServerGrid">
          <article class="webrtcServerPanel">
            <h2 class="webrtcStepLine" data-step-line="relay">1) Run signaling relay on the PC <span class="step-dot step-dot--idle" data-step-dot="relay"></span></h2>
            <pre class="json mono">python server.py</pre>
            <button class="btn webrtcCodeBtn" type="button" data-action="open-relay">Open code</button>
          </article>

          <article class="webrtcServerPanel">
            <h2 class="webrtcStepLine" data-step-line="phone">2) Open phone publisher page <span class="step-dot step-dot--idle" data-step-dot="phone"></span></h2>
            <ul>
              <li>Use phone and PC on the same Wi-Fi.</li>
              <li>Set phone signaling target from generated publisher HTML.</li>
              <li>Allow camera permission and send offer + ICE candidates.</li>
            </ul>
            <button class="btn webrtcCodeBtn" type="button" data-action="open-phone">Open code</button>
          </article>

          <article class="webrtcServerPanel">
            <h2>3) Open Camera Stream tab on this app</h2>
            <ul>
              <li class="webrtcStepLine" data-step-line="connect">Click <b>Connect to signaling server</b>. <span class="step-dot step-dot--idle" data-step-dot="connect"></span></li>
              <li class="webrtcStepLine" data-step-line="show">Click <b>Show video stream</b>. <span class="step-dot step-dot--idle" data-step-dot="show"></span></li>
              <li class="webrtcStepLine" data-step-line="track">Wait for remote track render. <span class="step-dot step-dot--idle" data-step-dot="track"></span></li>
            </ul>
          </article>
        </div>
      </section>
    </main>

    <div id="webrtcCodeModal" class="webrtcCodeModal hidden" role="dialog" aria-modal="true" aria-label="Code snippet">
      <div class="webrtcCodeBackdrop" data-close-modal="true"></div>
      <div class="webrtcCodeDialog">
        <div class="webrtcCodeTopRow">
          <strong id="webrtcModalTitle">Code snippet</strong>
          <div class="webrtcCodeTopActions">
            <button id="btnCopyHtmlTop" class="btn hidden" type="button">Copy HTML</button>
            <button id="btnCloseWebrtcCodeModal" class="btn" type="button">Close</button>
          </div>
        </div>

        <label class="field hidden" id="webrtcIpModeWrap" for="webrtcIpMode">
          <span>IP source</span>
          <select id="webrtcIpMode">
            <option value="hostname">Use resolved fallback</option>
            <option value="manual">Manual IP</option>
          </select>
        </label>

        <label class="field hidden" id="webrtcManualIpWrap" for="webrtcManualIp">
          <span>Manual PC LAN IP</span>
          <input id="webrtcManualIp" class="mono" placeholder="192.168.x.x" />
        </label>

        <div id="webrtcModalMeta" class="hint mono"></div>
        <pre id="webrtcCodeModalBody" class="json mono"></pre>

        <div class="webrtcCodeActions">
          <button id="btnCopyPath" class="btn hidden" type="button">Copy path</button>
          <button id="btnCopyCommand" class="btn hidden" type="button">Copy command</button>
          <button id="btnCopyCode" class="btn hidden" type="button">Copy code</button>
          <button id="btnDownloadRelay" class="btn hidden" type="button">Download server.py</button>
        </div>
      </div>
    </div>

    <div id="webrtcErrorModal" class="webrtcCodeModal hidden" role="dialog" aria-modal="true" aria-label="Step error details">
      <div class="webrtcCodeBackdrop" data-close-error-modal="true"></div>
      <div class="webrtcCodeDialog">
        <div class="webrtcCodeTopRow">
          <strong>Step failure details</strong>
          <button id="btnCloseWebrtcErrorModal" class="btn" type="button">Close</button>
        </div>
        <pre id="webrtcErrorModalBody" class="json mono"></pre>
      </div>
    </div>
  </div>
  `

  const stepStates: Record<StepId, StepState> = { relay: 'idle', phone: 'idle', connect: 'idle', show: 'idle', track: 'idle' }
  const stepErrors: Partial<Record<StepId, StepError>> = {}
  const lastSignals = { phone: 0, pc: 0 }

  const codeModalEl = root.querySelector<HTMLDivElement>('#webrtcCodeModal')!
  const modalTitleEl = root.querySelector<HTMLElement>('#webrtcModalTitle')!
  const modalMetaEl = root.querySelector<HTMLDivElement>('#webrtcModalMeta')!
  const modalBodyEl = root.querySelector<HTMLPreElement>('#webrtcCodeModalBody')!
  const btnCloseCodeModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')!
  const btnCopyPathEl = root.querySelector<HTMLButtonElement>('#btnCopyPath')!
  const btnCopyCommandEl = root.querySelector<HTMLButtonElement>('#btnCopyCommand')!
  const btnCopyCodeEl = root.querySelector<HTMLButtonElement>('#btnCopyCode')!
  const btnCopyHtmlTopEl = root.querySelector<HTMLButtonElement>('#btnCopyHtmlTop')!
  const btnDownloadRelayEl = root.querySelector<HTMLButtonElement>('#btnDownloadRelay')!

  const ipModeWrapEl = root.querySelector<HTMLLabelElement>('#webrtcIpModeWrap')!
  const ipModeEl = root.querySelector<HTMLSelectElement>('#webrtcIpMode')!
  const manualIpWrapEl = root.querySelector<HTMLLabelElement>('#webrtcManualIpWrap')!
  const manualIpEl = root.querySelector<HTMLInputElement>('#webrtcManualIp')!

  const resolvedConfigEl = root.querySelector<HTMLDivElement>('#resolvedConfig')!

  const errorModalEl = root.querySelector<HTMLDivElement>('#webrtcErrorModal')!
  const errorModalBodyEl = root.querySelector<HTMLPreElement>('#webrtcErrorModalBody')!
  const btnCloseErrorModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcErrorModal')!

  let currentGeneratedPhoneHtml = ''
  let pollTimer: number | null = null

  function setActionButtons(mode: 'relay' | 'phone' | 'none') {
    btnCopyPathEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyCommandEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyCodeEl.classList.toggle('hidden', mode !== 'relay')
    btnDownloadRelayEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyHtmlTopEl.classList.toggle('hidden', mode !== 'phone')
  }

  function setIpControlsVisible(visible: boolean) {
    ipModeWrapEl.classList.toggle('hidden', !visible)
    manualIpWrapEl.classList.toggle('hidden', !visible || ipModeEl.value !== 'manual')
  }

  function stateClass(state: StepState) {
    if (state === 'working') return 'step-dot--working'
    if (state === 'ok') return 'step-dot--ok'
    if (state === 'fail') return 'step-dot--fail'
    return 'step-dot--idle'
  }

  function setStepState(step: StepId, state: StepState, error?: { message: string; details?: unknown }) {
    stepStates[step] = state
    if (state === 'fail' && error) {
      stepErrors[step] = { message: error.message, details: error.details, snapshot: cloneSnapshot(stepStates), timestamp: new Date().toISOString() }
    }
    const dot = root.querySelector<HTMLElement>(`[data-step-dot="${step}"]`)
    if (dot) {
      dot.classList.remove('step-dot--idle', 'step-dot--working', 'step-dot--ok', 'step-dot--fail')
      dot.classList.add(stateClass(state))
    }
    const line = root.querySelector<HTMLElement>(`[data-step-line="${step}"]`)
    if (line) {
      line.classList.toggle('webrtcStepLine--clickable', state === 'fail')
      if (state !== 'fail') line.removeAttribute('tabindex')
      else line.setAttribute('tabindex', '0')
    }
  }

  function componentStateFromLastSeen(lastSeenMs: number): ComponentState {
    const age = Date.now() - lastSeenMs
    if (age < 3000) return 'online'
    if (age < 10000) return 'stale'
    return 'offline'
  }

  function setComponent(component: 'phone' | 'pc' | 'relay' | 'backend', values: { ip?: string; port?: string; state?: ComponentState }) {
    const row = root.querySelector<HTMLElement>(`[data-component="${component}"]`)
    if (!row) return
    if (values.ip != null) row.querySelector<HTMLElement>('[data-field="ip"]')!.textContent = values.ip
    if (values.port != null) row.querySelector<HTMLElement>('[data-field="port"]')!.textContent = values.port
    if (values.state != null) {
      const el = row.querySelector<HTMLElement>('[data-field="status"]')!
      el.classList.remove('systemStatus--online', 'systemStatus--stale', 'systemStatus--offline')
      el.classList.add(`systemStatus--${values.state}`)
    }
  }

  function closeCodeModal() { codeModalEl.classList.add('hidden') }
  function closeErrorModal() { errorModalEl.classList.add('hidden') }
  function showCodeModal() { codeModalEl.classList.remove('hidden') }

  async function copyText(text: string) {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(text)
  }

  function downloadTextFile(filename: string, content: string) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function currentConfig() {
    return resolveConfig(manualIpEl.value.trim(), ipModeEl.value as 'hostname' | 'manual')
  }

  function updatePhoneHtmlFromInputs() {
    setStepState('phone', 'working')
    const config = currentConfig()
    resolvedConfigEl.textContent = `Resolved relay ${config.relayUrl || 'unknown'} (source: ${config.source}). Fallback order: query -> localStorage -> hostname -> manual input.`

    if (!config.relayHost || isLoopbackHost(config.relayHost)) {
      const message = 'PC LAN IP is required before generating phone publisher HTML.'
      modalMetaEl.textContent = message
      modalBodyEl.textContent = ''
      root.dataset.phonePublisherHtml = ''
      setStepState('phone', 'fail', { message, details: { source: config.source } })
      return
    }

    currentGeneratedPhoneHtml = makePhonePublisherHtml(config.relayHost)
    root.dataset.phonePublisherHtml = currentGeneratedPhoneHtml
    modalMetaEl.textContent = `Using ${config.relayUrl} from ${config.source}.`
    modalBodyEl.textContent = currentGeneratedPhoneHtml
    localStorage.setItem(STORAGE_IP_KEY, config.relayHost)
    setComponent('phone', { ip: window.location.hostname || 'unknown', port: 'browser', state: 'online' })
    setComponent('pc', { ip: config.relayHost, port: 'camera-stream tab', state: componentStateFromLastSeen(lastSignals.pc || 0) })
    setComponent('relay', { ip: config.relayHost, port: String(config.relayPort) })
    setStepState('phone', 'ok')
  }

  async function checkRelayHealth() {
    const config = currentConfig()
    if (!config.relayHost) {
      setComponent('relay', { state: 'offline' })
      return
    }

    await new Promise<void>((resolve) => {
      let done = false
      const socket = new WebSocket(config.relayUrl)
      const timer = window.setTimeout(() => {
        if (done) return
        done = true
        try { socket.close() } catch {}
        setComponent('relay', { state: 'offline' })
        resolve()
      }, 1800)

      socket.addEventListener('open', () => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        try { socket.close() } catch {}
        setComponent('relay', { state: 'online', ip: config.relayHost, port: String(config.relayPort) })
        resolve()
      })

      socket.addEventListener('error', () => {
        if (done) return
        done = true
        window.clearTimeout(timer)
        setComponent('relay', { state: 'offline', ip: config.relayHost, port: String(config.relayPort) })
        resolve()
      })
    })
  }

  async function checkBackendHealth() {
    const endpoints = ['/api/health', '/health']
    for (const endpoint of endpoints) {
      try {
        const resp = await fetch(endpoint, { cache: 'no-store' })
        if (resp.ok) {
          setComponent('backend', { state: 'online', port: endpoint })
          return
        }
      } catch {}
    }
    setComponent('backend', { state: 'offline' })
  }

  async function openRelayModal() {
    setStepState('relay', 'working')
    modalTitleEl.textContent = 'Signaling relay script'
    modalMetaEl.textContent = `Path: ${RELAY_PATH}`
    modalBodyEl.textContent = `Path: ${RELAY_PATH}\n\n${RELAY_COMMANDS.join('\n')}\n\n${RELAY_CODE}`
    setActionButtons('relay')
    setIpControlsVisible(false)
    showCodeModal()
    await checkRelayHealth()
    const relayStatus = root.querySelector('[data-component="relay"] [data-field="status"]')
    if (relayStatus?.classList.contains('systemStatus--online')) setStepState('relay', 'ok')
    else setStepState('relay', 'fail', { message: 'Relay health check failed', details: { relay: currentConfig().relayUrl } })
  }

  async function openPhoneModal() {
    setStepState('phone', 'working')
    modalTitleEl.textContent = 'Phone publisher HTML'
    modalMetaEl.textContent = 'Preparing publisher HTML…'
    modalBodyEl.textContent = ''
    setActionButtons('phone')
    setIpControlsVisible(true)
    if (isLoopbackHost(window.location.hostname || '')) {
      ipModeEl.value = 'manual'
      manualIpEl.value = localStorage.getItem(STORAGE_IP_KEY) || ''
      manualIpWrapEl.classList.remove('hidden')
    } else {
      ipModeEl.value = 'hostname'
      manualIpEl.value = ''
    }
    showCodeModal()
    updatePhoneHtmlFromInputs()
  }

  function openErrorModal(step: StepId) {
    const error = stepErrors[step]
    if (!error) return
    errorModalBodyEl.textContent = JSON.stringify(error, null, 2)
    errorModalEl.classList.remove('hidden')
  }

  function startPolling() {
    if (pollTimer != null) window.clearInterval(pollTimer)
    pollTimer = window.setInterval(() => {
      void checkRelayHealth()
      void checkBackendHealth()
      const phoneState = lastSignals.phone > 0 ? componentStateFromLastSeen(lastSignals.phone) : 'offline'
      const pcState = lastSignals.pc > 0 ? componentStateFromLastSeen(lastSignals.pc) : 'offline'
      setComponent('phone', { state: phoneState, ip: window.location.hostname || 'unknown', port: 'browser' })
      setComponent('pc', { state: pcState })
    }, 2000)
  }

  root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.addEventListener('click', () => { void openRelayModal() })
  root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.addEventListener('click', () => { void openPhoneModal() })
  ipModeEl.addEventListener('change', () => {
    manualIpWrapEl.classList.toggle('hidden', ipModeEl.value !== 'manual')
    updatePhoneHtmlFromInputs()
  })
  manualIpEl.addEventListener('input', () => { if (ipModeEl.value === 'manual') updatePhoneHtmlFromInputs() })

  btnCopyPathEl.addEventListener('click', () => { void copyText(RELAY_PATH) })
  btnCopyCommandEl.addEventListener('click', () => { void copyText(RELAY_COMMANDS.join('\n')) })
  btnCopyCodeEl.addEventListener('click', () => { void copyText(RELAY_CODE) })
  btnCopyHtmlTopEl.addEventListener('click', () => { if (currentGeneratedPhoneHtml) void copyText(currentGeneratedPhoneHtml) })
  btnDownloadRelayEl.addEventListener('click', () => { downloadTextFile('server.py', RELAY_CODE) })

  btnCloseCodeModalEl.addEventListener('click', closeCodeModal)
  btnCloseErrorModalEl.addEventListener('click', closeErrorModal)

  codeModalEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.dataset.closeModal === 'true') closeCodeModal()
  })

  errorModalEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.dataset.closeErrorModal === 'true') closeErrorModal()
  })

  for (const step of STEP_ORDER) {
    const line = root.querySelector<HTMLElement>(`[data-step-line="${step}"]`)
    if (!line) continue
    line.addEventListener('click', () => { if (stepStates[step] === 'fail') openErrorModal(step) })
    line.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (stepStates[step] !== 'fail') return
      event.preventDefault()
      openErrorModal(step)
    })
  }

  const unsubscribers = [
    onAppEvent('WEBRTC_SIGNALING_CONNECTING', () => { setStepState('connect', 'working'); lastSignals.pc = Date.now() }),
    onAppEvent('WEBRTC_SIGNALING_CONNECTED', (detail) => {
      setStepState('connect', 'ok')
      lastSignals.pc = Date.now()
      const host = String(detail.host ?? currentConfig().relayHost)
      if (host) setComponent('pc', { ip: host })
    }),
    onAppEvent('WEBRTC_SIGNALING_FAILED', (detail) => setStepState('connect', 'fail', { message: String(detail.message ?? 'Signaling connection failed.'), details: detail })),
    onAppEvent('WEBRTC_VIEWER_READY', () => setStepState('show', 'working')),
    onAppEvent('WEBRTC_OFFER_RECEIVED', () => { lastSignals.phone = Date.now(); setStepState('track', 'working') }),
    onAppEvent('WEBRTC_REMOTE_TRACK', () => {
      lastSignals.phone = Date.now()
      lastSignals.pc = Date.now()
      setStepState('show', 'ok')
      setStepState('track', 'ok')
    }),
    onAppEvent('WEBRTC_REMOTE_TRACK_FAILED', (detail) => {
      const message = String(detail.message ?? 'WebRTC negotiation failed.')
      setStepState('show', 'fail', { message, details: detail })
      setStepState('track', 'fail', { message, details: detail })
    }),
  ]

  updatePhoneHtmlFromInputs()
  startPolling()

  root.addEventListener('DOMNodeRemoved', () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
    if (pollTimer != null) window.clearInterval(pollTimer)
  })
}
