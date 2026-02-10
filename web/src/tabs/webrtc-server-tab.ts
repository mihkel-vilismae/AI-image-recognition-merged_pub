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

type RelayInfoResponse = {
  relayPath: string
  relayExists: boolean
  runCommands: string[]
  relayCode: string
}

type PhonePublisherResponse = {
  ipCandidates: string[]
  selectedIp: string
  warning: boolean
  html: string
}

const STEP_ORDER: StepId[] = ['relay', 'phone', 'connect', 'show', 'track']

function cloneSnapshot(states: Record<StepId, StepState>): Record<StepId, StepState> {
  return { ...states }
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
        <label id="webrtcIpSelectWrap" class="field hidden" for="webrtcIpSelect">
          <span>PC LAN IP</span>
          <select id="webrtcIpSelect"></select>
        </label>
        <div id="webrtcModalMeta" class="hint mono"></div>
        <pre id="webrtcCodeModalBody" class="json mono"></pre>
        <div class="webrtcCodeActions">
          <button id="btnCopyPath" class="btn hidden" type="button">Copy path</button>
          <button id="btnCopyCommand" class="btn hidden" type="button">Copy command</button>
          <button id="btnCopyHtml" class="btn hidden" type="button">Copy HTML</button>
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
  const ipSelectWrapEl = root.querySelector<HTMLLabelElement>('#webrtcIpSelectWrap')!
  const ipSelectEl = root.querySelector<HTMLSelectElement>('#webrtcIpSelect')!
  const btnCloseCodeModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')!
  const btnCopyPathEl = root.querySelector<HTMLButtonElement>('#btnCopyPath')!
  const btnCopyCommandEl = root.querySelector<HTMLButtonElement>('#btnCopyCommand')!
  const btnCopyHtmlEl = root.querySelector<HTMLButtonElement>('#btnCopyHtml')!

  const errorModalEl = root.querySelector<HTMLDivElement>('#webrtcErrorModal')!
  const errorModalBodyEl = root.querySelector<HTMLPreElement>('#webrtcErrorModalBody')!
  const btnCloseErrorModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcErrorModal')!

  let relayInfoCache: RelayInfoResponse | null = null
  let phoneCache: PhonePublisherResponse | null = null

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

  function renderActionButtons(mode: 'relay' | 'phone' | 'none') {
    btnCopyPathEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyCommandEl.classList.toggle('hidden', mode !== 'relay')
    btnCopyHtmlEl.classList.toggle('hidden', mode !== 'phone')
  }

  async function copyText(text: string) {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(text)
  }

  async function openRelayModal() {
    setStepState('relay', 'working')
    modalTitleEl.textContent = 'Signaling relay (server.py)'
    modalMetaEl.textContent = 'Loading relay info…'
    modalBodyEl.textContent = ''
    ipSelectWrapEl.classList.add('hidden')
    renderActionButtons('none')
    showCodeModal()

    try {
      const response = await fetch('/api/webrtc/relay-info')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as RelayInfoResponse
      relayInfoCache = payload
      modalMetaEl.textContent = `Path: ${payload.relayPath}`
      modalBodyEl.textContent = `${payload.runCommands.join('\n')}\n\n${payload.relayCode}`
      renderActionButtons('relay')
      setStepState('relay', payload.relayExists ? 'ok' : 'fail', payload.relayExists ? undefined : { message: 'Relay script missing after request.' })
    } catch (error) {
      const msg = `Failed to load relay info: ${String(error)}`
      modalMetaEl.textContent = msg
      modalBodyEl.textContent = ''
      renderActionButtons('none')
      setStepState('relay', 'fail', { message: msg, details: { error: String(error) } })
    }
  }

  async function loadPhonePublisher(ip?: string) {
    const query = ip ? `?ip=${encodeURIComponent(ip)}` : ''
    const response = await fetch(`/api/webrtc/phone-publisher${query}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return (await response.json()) as PhonePublisherResponse
  }

  async function openPhoneModal() {
    setStepState('phone', 'working')
    modalTitleEl.textContent = 'Phone publisher HTML'
    modalMetaEl.textContent = 'Loading publisher HTML…'
    modalBodyEl.textContent = ''
    ipSelectWrapEl.classList.remove('hidden')
    ipSelectEl.innerHTML = ''
    renderActionButtons('none')
    showCodeModal()

    try {
      const payload = await loadPhonePublisher()
      phoneCache = payload
      ipSelectEl.innerHTML = payload.ipCandidates.map((ip) => `<option value="${ip}">${ip}</option>`).join('')
      ipSelectEl.value = payload.selectedIp
      modalMetaEl.textContent = payload.warning
        ? `Using fallback IP ${payload.selectedIp}. Verify LAN networking.`
        : `Using PC_LAN_IP=${payload.selectedIp}`
      modalBodyEl.textContent = payload.html
      renderActionButtons('phone')
      setStepState('phone', payload.html.includes(`ws://${payload.selectedIp}:8765`) ? 'ok' : 'fail',
        payload.html.includes(`ws://${payload.selectedIp}:8765`) ? undefined : { message: 'Publisher HTML missing ws URL.' })
    } catch (error) {
      const msg = `Failed to load phone publisher HTML: ${String(error)}`
      modalMetaEl.textContent = msg
      modalBodyEl.textContent = ''
      renderActionButtons('none')
      setStepState('phone', 'fail', { message: msg, details: { error: String(error) } })
    }
  }

  async function openErrorModalForStep(step: StepId) {
    const err = stepErrors[step]
    if (!err) return
    errorModalBodyEl.textContent = JSON.stringify(err, null, 2)
    errorModalEl.classList.remove('hidden')
  }

  root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.addEventListener('click', () => {
    void openRelayModal()
  })

  root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.addEventListener('click', () => {
    void openPhoneModal()
  })

  ipSelectEl.addEventListener('change', () => {
    const selected = ipSelectEl.value
    if (!selected) return
    setStepState('phone', 'working')
    void loadPhonePublisher(selected)
      .then((payload) => {
        phoneCache = payload
        modalMetaEl.textContent = payload.warning
          ? `Using fallback IP ${payload.selectedIp}. Verify LAN networking.`
          : `Using PC_LAN_IP=${payload.selectedIp}`
        modalBodyEl.textContent = payload.html
        setStepState('phone', payload.html.includes(`ws://${payload.selectedIp}:8765`) ? 'ok' : 'fail')
      })
      .catch((error) => {
        const msg = `Failed to update phone publisher HTML: ${String(error)}`
        setStepState('phone', 'fail', { message: msg, details: { error: String(error) } })
      })
  })

  btnCopyPathEl.addEventListener('click', () => {
    if (!relayInfoCache) return
    void copyText(relayInfoCache.relayPath)
  })

  btnCopyCommandEl.addEventListener('click', () => {
    if (!relayInfoCache) return
    void copyText(relayInfoCache.runCommands.join('\n'))
  })

  btnCopyHtmlEl.addEventListener('click', () => {
    if (!phoneCache) return
    void copyText(phoneCache.html)
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
      void openErrorModalForStep(step)
    })
    line.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (stepStates[step] !== 'fail') return
      event.preventDefault()
      void openErrorModalForStep(step)
    })
  }

  const unsubscribers = [
    onAppEvent('SIGNALING_CONNECTING', () => setStepState('connect', 'working')),
    onAppEvent('SIGNALING_CONNECTED', () => setStepState('connect', 'ok')),
    onAppEvent('SIGNALING_FAILED', (detail) =>
      setStepState('connect', 'fail', {
        message: String(detail.message ?? 'Signaling connection failed.'),
        details: detail,
      }),
    ),
    onAppEvent('VIEWER_READY_SENT', () => setStepState('show', 'working')),
    onAppEvent('OFFER_RECEIVED', () => setStepState('track', 'working')),
    onAppEvent('REMOTE_TRACK_ATTACHED', () => {
      setStepState('show', 'ok')
      setStepState('track', 'ok')
    }),
    onAppEvent('REMOTE_TRACK_FAILED', (detail) => {
      const message = String(detail.message ?? 'Remote track negotiation failed.')
      setStepState('show', 'fail', { message, details: detail })
      setStepState('track', 'fail', { message, details: detail })
    }),
  ]

  root.addEventListener('DOMNodeRemoved', () => {
    for (const off of unsubscribers) off()
  })
}
