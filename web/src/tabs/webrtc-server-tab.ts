import './tab-style.css'

import { DEFAULT_SIGNALING_PORT } from './camera-stream-utils'

type SnippetKey = 'relay' | 'phone' | 'viewer' | 'signaling'

const CODE_SNIPPETS: Record<SnippetKey, string> = {
  relay: 'python server.py',
  phone: `// in phone.html\nconst signalingUrl = 'ws://PC_LAN_IP:${DEFAULT_SIGNALING_PORT}'\n\nconst socket = new WebSocket(signalingUrl)\n// getUserMedia + createOffer + ICE candidate exchange`,
  viewer: `// in Camera Stream tab\n1) Connect to signaling server\n2) Show video stream\n\n// app sends\n{ \"type\": \"viewer-ready\", \"wants\": \"video-stream\" }`,
  signaling: `{ "type": "offer", "sdp": "..." }\n{ "type": "answer", "sdp": "..." }\n{ "type": "candidate", "candidate": { ... } }`,
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
            <h2>1) Run signaling relay on the PC</h2>
            <pre class="json mono">python server.py</pre>
            <button class="btn webrtcCodeBtn" type="button" data-snippet="relay">Open code</button>
            <p class="hint">Relay must listen on <b>0.0.0.0:${DEFAULT_SIGNALING_PORT}</b> so your phone can connect over LAN.</p>
          </article>

          <article class="webrtcServerPanel">
            <h2>2) Open phone publisher page</h2>
            <ul>
              <li>Use phone and PC on the same Wi-Fi.</li>
              <li>Set phone signaling target to <span class="mono">ws://PC_LAN_IP:${DEFAULT_SIGNALING_PORT}</span>.</li>
              <li>Allow camera permission and send offer + ICE candidates.</li>
            </ul>
            <button class="btn webrtcCodeBtn" type="button" data-snippet="phone">Open code</button>
          </article>

          <article class="webrtcServerPanel">
            <h2>3) Open Camera Stream tab on this app</h2>
            <ul>
              <li>Click <b>Connect to signaling server</b>.</li>
              <li>Click <b>Show video stream</b> (sends <span class="mono">viewer-ready</span>).</li>
              <li>When phone offer arrives, this app answers and renders remote track.</li>
            </ul>
            <button class="btn webrtcCodeBtn" type="button" data-snippet="viewer">Open code</button>
          </article>

          <article class="webrtcServerPanel">
            <h2>Signaling messages (JSON)</h2>
            <pre class="json mono">{ "type": "offer", "sdp": "..." }
{ "type": "answer", "sdp": "..." }
{ "type": "candidate", "candidate": { ... } }</pre>
            <button class="btn webrtcCodeBtn" type="button" data-snippet="signaling">Open code</button>
          </article>
        </div>

        <div class="webrtcServerChecklist">
          <h2>Troubleshooting checklist</h2>
          <ul>
            <li>Phone cannot connect: verify PC LAN IP + firewall + relay bind address.</li>
            <li>Offer/answer works but no video: ensure ICE candidates are exchanged both directions.</li>
            <li>No camera on phone: use HTTPS/local secure context where mobile browser requires it.</li>
          </ul>
        </div>
      </section>
    </main>

    <div id="webrtcCodeModal" class="webrtcCodeModal hidden" role="dialog" aria-modal="true" aria-label="Code snippet">
      <div class="webrtcCodeBackdrop" data-close-modal="true"></div>
      <div class="webrtcCodeDialog">
        <div class="webrtcCodeTopRow">
          <strong>Code snippet</strong>
          <button id="btnCloseWebrtcCodeModal" class="btn" type="button">Close</button>
        </div>
        <pre id="webrtcCodeModalBody" class="json mono"></pre>
      </div>
    </div>
  </div>
  `

  const modalEl = root.querySelector<HTMLDivElement>('#webrtcCodeModal')!
  const modalBodyEl = root.querySelector<HTMLPreElement>('#webrtcCodeModalBody')!
  const btnCloseModalEl = root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')!

  function closeModal() {
    modalEl.classList.add('hidden')
    modalBodyEl.textContent = ''
  }

  function openModal(snippet: string) {
    modalBodyEl.textContent = snippet
    modalEl.classList.remove('hidden')
  }

  btnCloseModalEl.addEventListener('click', closeModal)

  modalEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (target?.dataset.closeModal === 'true') closeModal()
  })

  for (const btn of root.querySelectorAll<HTMLButtonElement>('.webrtcCodeBtn')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.snippet as SnippetKey | undefined
      if (!key) return
      const snippet = CODE_SNIPPETS[key]
      if (!snippet) return
      openModal(snippet)
    })
  }
}
