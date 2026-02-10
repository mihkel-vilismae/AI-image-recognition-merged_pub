import './tab-style.css'

import { DEFAULT_SIGNALING_PORT } from './camera-stream-utils'

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
            <p class="hint">Relay must listen on <b>0.0.0.0:${DEFAULT_SIGNALING_PORT}</b> so your phone can connect over LAN.</p>
          </article>

          <article class="webrtcServerPanel">
            <h2>2) Open phone publisher page</h2>
            <ul>
              <li>Use phone and PC on the same Wi-Fi.</li>
              <li>Set phone signaling target to <span class="mono">ws://PC_LAN_IP:${DEFAULT_SIGNALING_PORT}</span>.</li>
              <li>Allow camera permission and send offer + ICE candidates.</li>
            </ul>
          </article>

          <article class="webrtcServerPanel">
            <h2>3) Open Camera Stream tab on this app</h2>
            <ul>
              <li>Click <b>Connect to signaling server</b>.</li>
              <li>Click <b>Show video stream</b> (sends <span class="mono">viewer-ready</span>).</li>
              <li>When phone offer arrives, this app answers and renders remote track.</li>
            </ul>
          </article>

          <article class="webrtcServerPanel">
            <h2>Signaling messages (JSON)</h2>
            <pre class="json mono">{ "type": "offer", "sdp": "..." }
{ "type": "answer", "sdp": "..." }
{ "type": "candidate", "candidate": { ... } }</pre>
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
  </div>
  `
}
