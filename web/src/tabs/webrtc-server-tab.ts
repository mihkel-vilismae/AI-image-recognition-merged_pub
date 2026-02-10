import './tab-style.css'

import { onAppEvent } from '../common'

type StepId = 'relay' | 'phone' | 'connect' | 'show' | 'track'
type StepState = 'idle' | 'working' | 'ok' | 'fail'

type StepError = {
  message: string
  details?: unknown
  snapshot: Record<StepId, StepState>
  timestamp: string
}

const RELAY_PATH = 'tools/webrtc-relay/server.py'
const RELAY_COMMANDS = ['cd tools/webrtc-relay', 'pip install websockets', 'python server.py']
const RELAY_CODE = `import asyncio
import websockets

clients = set()


async def relay(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            for client in tuple(clients):
                if client is websocket:
                    continue
                try:
                    await client.send(message)
                except Exception:
                    pass
    finally:
        clients.discard(websocket)


async def main():
    async with websockets.serve(relay, "0.0.0.0", 8765):
        print("WebSocket relay listening on ws://0.0.0.0:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
`

const STEP_ORDER: StepId[] = ['relay', 'phone', 'connect', 'show', 'track']


const FALLBACK_PHONE_TEMPLATE = `<html>
  <button id="btnFront"></button>
  <button id="btnBack"></button>
  <div id="log"></div>
  <div id="error"></div>
  ws://__PC_LAN_IP__:8765
</html>`


function cloneSnapshot(states: Record<StepId, StepState>): Record<StepId, StepState> {
  return { ...states }
}

function isLoopbackHost(hostname: string): boolean {
  const h = (hostname || '').toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1'
}

function isLikelyIpv4(input: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(input.trim())
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
        <div class="webrtcServerIntro">
          <p>
            This tab documents the exact phone → signaling server → Camera Stream tab pipeline.
            Keep this tab open while setting up your phone publisher and Python signaling relay.
          </p>
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
              <li class="webrtcStepLine" data-step-line="show">Click <b>Show video stream</b> (sends <span class="mono">viewer-ready</span>). <span class="step-dot step-dot--idle" data-step-dot="show"></span></li>
              <li class="webrtcStepLine" data-step-line="track">When phone offer arrives, this app answers and renders remote track. <span class="step-dot step-dot--idle" data-step-dot="track"></span></li>
            </ul>
          </article>

          <article class="webrtcServerPanel">
            <h2>Signaling messages (JSON)</h2>
            <pre class="json mono">{ "type": "offer", "sdp": "..." }
{ "type": "answer", "sdp": "..." }
{ "type": "candidate", "candidate": { ... } }</pre>
          </article>
        </div>
      </section>
    </main>

    <div id="webrtcCodeModal" class="webrtcCodeModal hidden" role="dialog" aria-modal="true" aria-label="Code snippet">
      <div class="webrtcCodeBackdrop" data-close-modal="true"></div>
      <div class="webrtcCodeDialog">
        <div class="webrtcCodeTopRow">
          <strong id="webrtcModalTitle">Code snippet</strong>
          <button id="btnCloseWebrtcCodeModal" class="btn" type="button">Close</button>
        </div>

        <label class="field hidden" id="webrtcIpModeWrap" for="webrtcIpMode">
          <span>IP source</span>
          <select id="webrtcIpMode">
            <option value="hostname">Use hostname from current URL</option>
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
          <button id="btnCopyHtml" class="btn hidden" type="button">Copy HTML</button>
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

  const stepStates: Record<StepId, StepState> = {
    relay: 'idle',
    phone: 'idle',
    connect: 'idle',
    show: 'idle',
    track: 'idle',
  }
  const stepErrors: Partial<Record<StepId, StepError>> = {}

  const codeModalEl = root.querySelector<HTMLDivElement>('#webrtcCodeModal')!
  const modalTitleEl = root.querySelector<HTMLElement>('#webrtcModalTitle')!
  const modalMetaEl = root.querySelector<HTMLDivElement>('#webrtcModalMeta')!
  const modalBodyEl = root.querySelector<HTMLPreElement>('#webrtcCodeModalBody')!
  const btnCloseCodeModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')!
  const btnCopyPathEl = root.querySelector<HTMLButtonElement>('#btnCopyPath')!
  const btnCopyCommandEl = root.querySelector<HTMLButtonElement>('#btnCopyCommand')!
  const btnCopyCodeEl = root.querySelector<HTMLButtonElement>('#btnCopyCode')!
  const btnCopyHtmlEl = root.querySelector<HTMLButtonElement>('#btnCopyHtml')!
  const btnDownloadRelayEl = root.querySelector<HTMLButtonElement>('#btnDownloadRelay')!

  const ipModeWrapEl = root.querySelector<HTMLLabelElement>('#webrtcIpModeWrap')!
  const ipModeEl = root.querySelector<HTMLSelectElement>('#webrtcIpMode')!
  const manualIpWrapEl = root.querySelector<HTMLLabelElement>('#webrtcManualIpWrap')!
  const manualIpEl = root.querySelector<HTMLInputElement>('#webrtcManualIp')!

  const errorModalEl = root.querySelector<HTMLDivElement>('#webrtcErrorModal')!
  const errorModalBodyEl = root.querySelector<HTMLPreElement>('#webrtcErrorModalBody')!
  const btnCloseErrorModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcErrorModal')!

  const defaultHost = window.location.hostname || 'localhost'
  let currentGeneratedPhoneHtml = ''
  let cachedTemplate = ''

  function setActionButtons(mode: 'relay' | 'phone' | 'none') {
    btnCopyPathEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyCommandEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyCodeEl.classList.toggle('hidden', mode !== 'relay')
    btnDownloadRelayEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyHtmlEl.classList.toggle('hidden', mode !== 'phone')
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
      stepErrors[step] = {
        message: error.message,
        details: error.details,
        snapshot: cloneSnapshot(stepStates),
        timestamp: new Date().toISOString(),
      }
    }

    const dot = root.querySelector<HTMLElement>(`[data-step-dot="${step}"]`)
    if (dot) {
      dot.classList.remove('step-dot--idle', 'step-dot--working', 'step-dot--ok', 'step-dot--fail')
      dot.classList.add(stateClass(state))
    }

    const line = root.querySelector<HTMLElement>(`[data-step-line="${step}"]`)
    if (line) {
      line.classList.toggle('webrtcStepLine--clickable', state === 'fail')
      if (state !== 'fail') {
        line.removeAttribute('tabindex')
      } else {
        line.setAttribute('tabindex', '0')
      }
    }
  }

  function closeCodeModal() {
    codeModalEl.classList.add('hidden')
  }

  function closeErrorModal() {
    errorModalEl.classList.add('hidden')
  }

  function showCodeModal() {
    codeModalEl.classList.remove('hidden')
  }

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

  function activeIp(): string {
    if (ipModeEl.value === 'manual') return manualIpEl.value.trim()
    return defaultHost.trim()
  }

  async function loadPhoneTemplate(): Promise<string> {
    if (cachedTemplate) return cachedTemplate
    const response = await fetch('/phone-publisher.template.html', { cache: 'no-store' })
    if (!response.ok) throw new Error(`Template fetch failed: HTTP ${response.status}`)
    cachedTemplate = await response.text()
    return cachedTemplate
  }

  function renderPhoneHtml(ip: string, template: string) {
    const resolvedIp = ip || ''
    if (!template.includes('__PC_LAN_IP__')) {
      throw new Error('Template token __PC_LAN_IP__ is missing in phone-publisher.template.html')
    }
    return template.split('__PC_LAN_IP__').join(resolvedIp)
  }

  function updatePhoneHtmlFromInputs() {
    setStepState('phone', 'working')
    const ip = activeIp()

    if (!ip) {
      const message = 'PC LAN IP is required. Enter manual IP or open app via LAN hostname.'
      modalMetaEl.textContent = message
      modalBodyEl.textContent = ''
      root.dataset.phonePublisherHtml = ''
      setStepState('phone', 'fail', { message, details: { mode: ipModeEl.value } })
      return
    }

    if (ipModeEl.value === 'manual' && !isLikelyIpv4(ip)) {
      const message = `Manual IP is invalid: ${ip}`
      modalMetaEl.textContent = message
      modalBodyEl.textContent = ''
      setStepState('phone', 'fail', { message, details: { ip } })
      return
    }

    try {
      currentGeneratedPhoneHtml = renderPhoneHtml(ip, cachedTemplate)
      root.dataset.phonePublisherHtml = currentGeneratedPhoneHtml
      if (currentGeneratedPhoneHtml.includes('__PC_LAN_IP__')) {
        throw new Error('Publisher HTML still contains __PC_LAN_IP__ placeholder after replacement.')
      }
      modalMetaEl.textContent = isLoopbackHost(defaultHost)
        ? `Using ${ip}. If this is not your LAN IP, update it manually.`
        : `Using URL hostname ${ip} from current web app origin.`
      modalBodyEl.textContent = currentGeneratedPhoneHtml
      setStepState('phone', 'ok')
    } catch (error) {
      const message = `Failed to generate phone publisher HTML: ${String(error)}`
      modalMetaEl.textContent = message
      modalBodyEl.textContent = ''
      setStepState('phone', 'fail', { message, details: { error: String(error), ip } })
    }
  }

  async function openRelayModal() {
    setStepState('relay', 'working')
    modalTitleEl.textContent = 'Signaling relay script'
    modalMetaEl.textContent = `Path: ${RELAY_PATH}`
    modalBodyEl.textContent = `Path: ${RELAY_PATH}\n\n${RELAY_COMMANDS.join('\n')}\n\n${RELAY_CODE}`
    setActionButtons('relay')
    setIpControlsVisible(false)
    showCodeModal()
    setStepState('relay', 'ok')
  }

  async function openPhoneModal() {
    setStepState('phone', 'working')
    modalTitleEl.textContent = 'Phone publisher HTML'
    modalBodyEl.textContent = ''
    modalMetaEl.textContent = 'Loading local template…'
    setActionButtons('phone')
    setIpControlsVisible(true)

    if (isLoopbackHost(defaultHost)) {
      ipModeEl.value = 'manual'
      manualIpEl.value = '127.0.0.1'
      manualIpWrapEl.classList.remove('hidden')
      modalMetaEl.textContent =
        'Current URL hostname is loopback. Replace 127.0.0.1 with your PC LAN IP (for example 192.168.x.x), or open this web app via its LAN URL.'
    } else {
      ipModeEl.value = 'hostname'
      manualIpEl.value = defaultHost
      manualIpWrapEl.classList.add('hidden')
    }

    cachedTemplate = FALLBACK_PHONE_TEMPLATE
    try {
      const bootstrapIp = (ipModeEl.value === 'manual' ? manualIpEl.value.trim() : defaultHost.trim()) || '127.0.0.1'
      currentGeneratedPhoneHtml = renderPhoneHtml(bootstrapIp, cachedTemplate)
      root.dataset.phonePublisherHtml = currentGeneratedPhoneHtml
      modalBodyEl.textContent = currentGeneratedPhoneHtml
      setStepState('phone', 'ok')
    } catch {}
    showCodeModal()

    try {
      cachedTemplate = await loadPhoneTemplate()
      if (ipModeEl.value !== 'manual') {
        manualIpEl.value = defaultHost
      }
      updatePhoneHtmlFromInputs()
    } catch (error) {
      const message = `Failed to load local phone template: ${String(error)}`
      modalMetaEl.textContent = message
      setStepState('phone', 'fail', { message, details: { error: String(error) } })
    }
  }

  function openErrorModal(step: StepId) {
    const error = stepErrors[step]
    if (!error) return
    errorModalBodyEl.textContent = JSON.stringify(error, null, 2)
    errorModalEl.classList.remove('hidden')
  }

  root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.addEventListener('click', () => {
    void openRelayModal().catch((error) => {
      const message = `Failed to open relay modal: ${String(error)}`
      setStepState('relay', 'fail', { message, details: { error: String(error) } })
    })
  })

  root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.addEventListener('click', () => {
    void openPhoneModal().catch((error) => {
      const message = `Failed to open phone modal: ${String(error)}`
      setStepState('phone', 'fail', { message, details: { error: String(error) } })
    })
  })

  ipModeEl.addEventListener('change', () => {
    manualIpWrapEl.classList.toggle('hidden', ipModeEl.value !== 'manual')
    if (cachedTemplate) updatePhoneHtmlFromInputs()
  })

  manualIpEl.addEventListener('input', () => {
    if (cachedTemplate && ipModeEl.value === 'manual') updatePhoneHtmlFromInputs()
  })

  btnCopyPathEl.addEventListener('click', () => {
    void copyText(RELAY_PATH)
  })

  btnCopyCommandEl.addEventListener('click', () => {
    void copyText(RELAY_COMMANDS.join('\n'))
  })

  btnCopyCodeEl.addEventListener('click', () => {
    void copyText(RELAY_CODE)
  })

  btnCopyHtmlEl.addEventListener('click', () => {
    if (!currentGeneratedPhoneHtml) return
    void copyText(currentGeneratedPhoneHtml)
  })

  btnDownloadRelayEl.addEventListener('click', () => {
    downloadTextFile('server.py', RELAY_CODE)
  })

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
    line.addEventListener('click', () => {
      if (stepStates[step] !== 'fail') return
      openErrorModal(step)
    })
    line.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (stepStates[step] !== 'fail') return
      event.preventDefault()
      openErrorModal(step)
    })
  }

  const unsubscribers = [
    onAppEvent('WEBRTC_SIGNALING_CONNECTING', () => setStepState('connect', 'working')),
    onAppEvent('WEBRTC_SIGNALING_CONNECTED', () => setStepState('connect', 'ok')),
    onAppEvent('WEBRTC_SIGNALING_FAILED', (detail) =>
      setStepState('connect', 'fail', {
        message: String(detail.message ?? 'Signaling connection failed.'),
        details: detail,
      }),
    ),
    onAppEvent('WEBRTC_VIEWER_READY_SENT', () => setStepState('show', 'working')),
    onAppEvent('WEBRTC_OFFER_RECEIVED', () => setStepState('track', 'working')),
    onAppEvent('WEBRTC_REMOTE_TRACK_RECEIVED', () => {
      setStepState('show', 'ok')
      setStepState('track', 'ok')
    }),
    onAppEvent('WEBRTC_NEGOTIATION_FAILED', (detail) => {
      const message = String(detail.message ?? 'WebRTC negotiation failed.')
      setStepState('show', 'fail', { message, details: detail })
      setStepState('track', 'fail', { message, details: detail })
    }),
  ]

  root.addEventListener('DOMNodeRemoved', () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  })
}
