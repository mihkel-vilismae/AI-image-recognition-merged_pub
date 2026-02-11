import './tab-style.css'

import { onAppEvent } from '../common'
import { DEFAULT_AI_BASE_URL, getAiBaseUrlFromStorage, STORAGE_SIGNALING_URL_KEY } from './shared-config'
import { buildHealthTargets } from './health-targets'
import { checkHealth, type HealthCheckResult, type HealthKind } from './health-check'

type StepId = 'relay' | 'phone' | 'connect' | 'show' | 'track'
type StepState = 'idle' | 'working' | 'ok' | 'fail'
type ComponentState = 'online' | 'stale' | 'offline' | 'paused'

type StepError = {
  message: string
  details?: unknown
  snapshot: Record<StepId, StepState>
  timestamp: string
}

type ResolvedConfig = {
  relayHost: string
  relayPort: number
  relayUrl: string
  relayHealthUrl: string
  aiHealthUrl: string
  webUiUrl: string
  pcHealthUrl: string
  pcKind: 'pc' | 'webUi'
  source: 'query-relay' | 'query-ip' | 'storage' | 'hostname' | 'manual'
  unknownReason?: string
}

const RELAY_PATH = 'tools/webrtc-relay/server.py'
const RELAY_COMMANDS = ['cd tools/webrtc-relay', 'pip install websockets', 'python server.py']
const RELAY_CODE = `import asyncio
import contextlib
import json
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import websockets
from websockets.exceptions import ConnectionClosed

clients = set()
VERSION = "1.1.0"
HEALTH_PORT = 8766


class HealthHandler(BaseHTTPRequestHandler):
    def _write_json(self, status: int, payload: dict):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/health":
            self._write_json(
                200,
                {
                    "ok": True,
                    "service": "webrtc-signaling-relay",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "version": VERSION,
                    "ws": "ws://0.0.0.0:8765",
                    "http": f"http://0.0.0.0:{HEALTH_PORT}/health",
                },
            )
            return
        self._write_json(404, {"ok": False, "error": "not_found"})

    def log_message(self, _format, *_args):
        return


def start_health_server():
    server = ThreadingHTTPServer(("0.0.0.0", HEALTH_PORT), HealthHandler)
    print(f"Health endpoint listening on http://0.0.0.0:{HEALTH_PORT}/health")
    server.serve_forever()


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
    health_thread = threading.Thread(target=start_health_server, daemon=True)
    health_thread.start()

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
const STORAGE_PC_BASE_KEY = 'webrtc.pcBaseUrl'
const STORAGE_HEALTH_TOGGLE_PREFIX = 'webrtc.healthToggle.'
const STEP_ORDER: StepId[] = ['relay', 'phone', 'connect', 'show', 'track']
const globalHealthControllers: Partial<Record<'phone' | 'pc' | 'relay' | 'backend', AbortController>> = {}

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

function parseWsHostPort(input: string): { host: string; port: number } | null {
  const value = (input || '').trim()
  if (!value) return null
  try {
    const parsed = new URL(value.includes('://') ? value : `ws://${value}`)
    return { host: parsed.hostname, port: Number(parsed.port || '8765') }
  } catch {
    return null
  }
}

function stateClass(state: StepState) {
  if (state === 'working') return 'step-dot--working'
  if (state === 'ok') return 'step-dot--ok'
  if (state === 'fail') return 'step-dot--fail'
  return 'step-dot--idle'
}

function componentStateFromLastSeen(lastSeenMs: number): ComponentState {
  const age = Date.now() - lastSeenMs
  if (age < 3000) return 'online'
  if (age < 10000) return 'stale'
  return 'offline'
}

async function pollHealth(component: 'pc' | 'relay' | 'backend', kind: HealthKind, url: string): Promise<HealthCheckResult> {
  const result = await checkHealth({ kind, url, timeoutMs: 1800 })
  return result
}

function formatHealthFailureDetails(result: HealthCheckResult): string {
  const parts = [
    `url=${result.url}`,
    `status=${String(result.status)}`,
    `contentType=${result.contentType || 'unknown'}`,
  ]
  if (result.error) parts.push(`error=${result.error}`)
  if (result.parseError) parts.push(`parseError=${result.parseError}`)
  if (result.preview) parts.push(`preview=${result.preview.replace(/\s+/g, ' ').trim()}`)
  return parts.join(' | ')
}

function buildPhonePublisherHtml(relayUrl: string) {
  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phone Publisher</title>
</head>
<body>
<button id="btnStart">Start camera</button>
<button id="btnCopyLogs" type="button">Copy logs</button>
<pre id="log"></pre>
<pre id="error" style="color:#b91c1c;border:1px solid #ef4444;padding:8px"></pre>
<script>
const SIGNALING_URL = "${relayUrl}";
let pc, ws, stream;
let sentCandidates = 0;
let recvCandidates = 0;
let heartbeatTimer = null;
let remoteAnswerApplied = false;
let remoteAnswerSdp = "";
let applyingRemoteAnswer = false;
let currentOfferSdp = "";
let lastIgnoredAnswerKey = "";
let pendingRemoteCandidates = [];
const seenRemoteCandidateKeys = new Set();
const logEl = document.getElementById("log");
const errorEl = document.getElementById("error");
const ts = () => new Date().toISOString();
const push = (lvl, tag, msg, data) => {
  const suffix = data == null ? "" : " " + (typeof data === "string" ? data : JSON.stringify(data));
  const line = "[" + ts() + "] [" + lvl + "] [" + tag + "] " + msg + suffix;
  (lvl === "ERR" ? errorEl : logEl).textContent += line + "\\n";
  if (lvl === "ERR") errorEl.style.background = "#fee2e2";
};
window.onerror = (message, source, lineno, colno, err) => {
  push("ERR", "ERR", "window.onerror", { message, source, lineno, colno, stack: err && err.stack ? err.stack : undefined });
};
window.onunhandledrejection = (event) => {
  push("ERR", "ERR", "unhandledrejection", { reason: String(event.reason) });
};
document.getElementById("btnCopyLogs").onclick = async () => {
  const text = "LOG\\n" + logEl.textContent + "\\nERROR\\n" + errorEl.textContent;
  try { await navigator.clipboard.writeText(text); push("INFO", "STEP", "logs copied"); }
  catch (e) { push("ERR", "ERR", "copy logs failed", String(e)); }
};
const sendHeartbeat = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const v = stream ? stream.getVideoTracks()[0] : null;
  ws.send(JSON.stringify({ type: "publisher_heartbeat", ts: Date.now(), camera: { active: Boolean(v), trackReadyState: v ? v.readyState : "none", width: v && v.getSettings ? v.getSettings().width : null, height: v && v.getSettings ? v.getSettings().height : null }, webrtc: { sending: pc ? pc.connectionState === "connected" : false } }));
};

function candidateKey(candidate) {
  if (!candidate || typeof candidate !== "object") return "invalid";
  return String(candidate.candidate || "") + "|" + String(candidate.sdpMid || "") + "|" + String(candidate.sdpMLineIndex || "");
}
function parseIncomingMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw;
  if (typeof msg.type === "string") return msg;
  if (typeof msg.sdp === "string") {
    const inferredType = pc && pc.signalingState === "have-local-offer" ? "answer" : "offer";
    push("INFO", "WS", "missing type; inferred", { inferredType });
    return { ...msg, type: inferredType };
  }
  return null;
}
function noteIgnoredAnswer(reason, data) {
  const key = reason + "|" + JSON.stringify(data || {});
  if (key === lastIgnoredAnswerKey) return;
  lastIgnoredAnswerKey = key;
  push("INFO", "WEBRTC", reason, data);
}
function markOfferCreated(offerSdp) {
  currentOfferSdp = String(offerSdp || "");
  remoteAnswerApplied = false;
  remoteAnswerSdp = "";
  applyingRemoteAnswer = false;
  pendingRemoteCandidates = [];
  lastIgnoredAnswerKey = "";
}

async function applyRemoteAnswerOnce(answerSdp) {
  if (!pc) {
    noteIgnoredAnswer("answer ignored: no peer connection");
    return;
  }
  if (applyingRemoteAnswer) {
    noteIgnoredAnswer("answer ignored: apply in-flight");
    return;
  }
  if (remoteAnswerApplied) {
    if (answerSdp === remoteAnswerSdp) {
      noteIgnoredAnswer("duplicate answer ignored");
      return;
    }
    noteIgnoredAnswer("different answer ignored after apply", { signalingState: pc.signalingState });
    return;
  }
  if (pc.signalingState !== "have-local-offer") {
    noteIgnoredAnswer("answer ignored due to signalingState", { signalingState: pc.signalingState });
    return;
  }

  applyingRemoteAnswer = true;
  try {
    push("STEP", "WEBRTC", "setRemoteDescription start");
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    remoteAnswerApplied = true;
    remoteAnswerSdp = answerSdp;
    lastIgnoredAnswerKey = "";
    push("STEP", "WEBRTC", "setRemoteDescription ok");
    if (pendingRemoteCandidates.length > 0) {
      const queue = pendingRemoteCandidates.slice();
      pendingRemoteCandidates = [];
      for (const candidate of queue) {
        try {
          await pc.addIceCandidate(candidate);
          recvCandidates += 1;
        } catch (err) {
          push("ERR", "WEBRTC", "queued addIceCandidate failed", { raw: String(err) });
        }
      }
      push("WEBRTC", "WEBRTC", "queued candidates flushed", { flushed: queue.length, recvCandidates });
    }
  } catch (err) {
    push("ERR", "WEBRTC", "setRemoteDescription failed", { name: err && err.name, message: err && err.message, raw: String(err), signalingState: pc.signalingState });
  } finally {
    applyingRemoteAnswer = false;
  }
}

document.getElementById("btnStart").onclick = async () => {
  const btn = document.getElementById("btnStart");
  btn.disabled = true;
  try {
    push("STEP", "STEP", "start clicked", { relay: SIGNALING_URL });
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      push("INFO", "CAM", "enumerateDevices", devices.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })));
    } catch (e) {
      push("ERR", "CAM", "enumerateDevices failed", { name: e && e.name, message: e && e.message, raw: String(e) });
    }
    push("STEP", "CAM", "getUserMedia start", { constraints: { video: true } });
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    push("INFO", "CAM", "getUserMedia success", { tracks: stream.getTracks().length });
    ws = new WebSocket(SIGNALING_URL);
    ws.onopen = async () => {
      push("WS", "WS", "open", { url: SIGNALING_URL });
      pc = new RTCPeerConnection();
      pc.addEventListener("signalingstatechange", () => push("WEBRTC", "WEBRTC", "signalingstate", pc.signalingState));
      pc.addEventListener("icegatheringstatechange", () => push("WEBRTC", "WEBRTC", "icegatheringstate", pc.iceGatheringState));
      pc.addEventListener("iceconnectionstatechange", () => push("WEBRTC", "WEBRTC", "iceconnectionstate", pc.iceConnectionState));
      pc.addEventListener("connectionstatechange", () => push("WEBRTC", "WEBRTC", "connectionstate", pc.connectionState));
      stream.getTracks().forEach(t => {
        pc.addTrack(t, stream);
        push("INFO", "CAM", "track added", { id: t.id, kind: t.kind, label: t.label });
      });
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        sentCandidates += 1;
        ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
        push("WEBRTC", "WEBRTC", "candidate sent", { sentCandidates });
      };
      try {
        push("STEP", "WEBRTC", "createOffer start");
        const offer = await pc.createOffer();
        push("STEP", "WEBRTC", "createOffer ok", { sdpSize: (offer.sdp || "").length });
        push("STEP", "WEBRTC", "setLocalDescription start");
        await pc.setLocalDescription(offer);
        markOfferCreated(offer.sdp);
        push("STEP", "WEBRTC", "setLocalDescription ok");
        ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
        push("WS", "WS", "offer sent", { sdpSize: (offer.sdp || "").length });
      } catch (err) {
        push("ERR", "WEBRTC", "offer flow failed", { name: err && err.name, message: err && err.message, raw: String(err) });
      }
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, 1500);
    };
    ws.onmessage = async (event) => {
      push("WS", "WS", "message", { size: String(event.data || "").length });
      let parsed;
      try {
        parsed = JSON.parse(event.data);
      } catch (err) {
        push("ERR", "WS", "json parse failed", { raw: String(event.data), error: String(err) });
        return;
      }

      const msg = parseIncomingMessage(parsed);
      if (!msg || typeof msg.type !== "string") {
        push("INFO", "WS", "message ignored: missing/unknown type");
        return;
      }

      if (msg.type === "answer") {
        if (typeof msg.sdp !== "string" || !msg.sdp) {
          push("INFO", "WEBRTC", "answer ignored: missing sdp");
          return;
        }
        await applyRemoteAnswerOnce(msg.sdp);
        return;
      }

      if (msg.type === "candidate") {
        if (!msg.candidate) return;
        const key = candidateKey(msg.candidate);
        if (seenRemoteCandidateKeys.has(key)) {
          push("INFO", "WEBRTC", "duplicate candidate ignored");
          return;
        }
        seenRemoteCandidateKeys.add(key);

        if (!pc) {
          push("INFO", "WEBRTC", "candidate ignored: no peer connection");
          return;
        }

        if (!pc.remoteDescription) {
          pendingRemoteCandidates.push(msg.candidate);
          push("INFO", "WEBRTC", "candidate queued until remote description is set", { queued: pendingRemoteCandidates.length });
          return;
        }

        try {
          recvCandidates += 1;
          await pc.addIceCandidate(msg.candidate);
          push("WEBRTC", "WEBRTC", "candidate received", { recvCandidates });
        } catch (err) {
          push("ERR", "WEBRTC", "addIceCandidate failed", { raw: String(err) });
        }
      }
    };
    ws.onerror = () => push("ERR", "WS", "error");
    ws.onclose = (event) => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      push("ERR", "WS", "close", { code: event.code, reason: event.reason, wasClean: event.wasClean });
    };
  } catch (e) {
    push("ERR", "ERR", "start flow failed", { name: e && e.name, message: e && e.message, raw: String(e) });
    btn.disabled = false;
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
            <thead><tr><th>Component</th><th>IP</th><th>Health URL / Runtime</th><th>Health</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              <tr data-component="phone"><td>This device (phone publisher)</td><td data-field="ip">unknown</td><td data-field="healthUrl">runtime-only</td><td><input data-health-toggle="phone" type="checkbox" checked /></td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td><td data-field="details">waiting</td></tr>
              <tr data-component="pc"><td>PC receiver (optional)</td><td data-field="ip">unknown</td><td data-field="healthUrl">unknown</td><td><input data-health-toggle="pc" type="checkbox" checked /></td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td><td data-field="details">waiting</td></tr>
              <tr data-component="relay"><td>WS signaling relay</td><td data-field="ip">unknown</td><td data-field="healthUrl">unknown</td><td><input data-health-toggle="relay" type="checkbox" checked /></td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td><td data-field="details">waiting</td></tr>
              <tr data-component="backend"><td>AI server</td><td data-field="ip">unknown</td><td data-field="healthUrl">unknown</td><td><input data-health-toggle="backend" type="checkbox" checked /></td><td><span class="systemStatus systemStatus--offline" data-field="status"></span></td><td data-field="details">waiting</td></tr>
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
              <li>Use ERROR panel on phone page to see failures immediately.</li>
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
            <option value="hostname">Use fallback order</option>
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
  let currentGeneratedPhoneHtml = ''
  let pollTimer: number | null = null
  const lastSignals = { phone: 0, pc: 0, phoneCameraStarted: false, phoneWsConnected: false, phoneWebrtcConnected: false }
  const healthEnabled: Record<'phone' | 'pc' | 'relay' | 'backend', boolean> = { phone: true, pc: true, relay: true, backend: true }
  const lastHealthFailureKey: Partial<Record<'relay' | 'backend' | 'pc', string>> = {}

  function logHealthFailureOnce(component: 'relay' | 'backend' | 'pc', result: HealthCheckResult) {
    const details = formatHealthFailureDetails(result)
    const key = `${result.url}|${details}`
    if (lastHealthFailureKey[component] === key) return
    lastHealthFailureKey[component] = key
    const tag = component === 'backend' ? 'AI' : (component === 'relay' ? 'RELAY' : 'PC')
    console.warn(`[HEALTH][${tag}] check failed`, details)
  }

  function clearHealthFailure(component: 'relay' | 'backend' | 'pc') {
    lastHealthFailureKey[component] = ''
  }
  
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

  function resolveConfig(): ResolvedConfig {
    const params = new URLSearchParams(window.location.search)
    const relayParam = params.get('relay')?.trim() || ''
    const relayHostParam = params.get('relayHost')?.trim() || ''
    const ipParam = params.get('ip')?.trim() || ''
    const pcBaseParam = params.get('pcBase')?.trim() || ''

    const storageRelay = localStorage.getItem(STORAGE_RELAY_KEY)?.trim() || localStorage.getItem(STORAGE_SIGNALING_URL_KEY)?.trim() || ''
    const storageIp = localStorage.getItem(STORAGE_IP_KEY)?.trim() || ''
    const storagePcBase = localStorage.getItem(STORAGE_PC_BASE_KEY)?.trim() || ''
    const hostname = (window.location.hostname || '').trim()

    const relayParsed = parseWsHostPort(relayParam)
    let relayHost = ''
    let relayPort = 8765
    let source: ResolvedConfig['source'] = 'manual'

    if (relayParsed) {
      relayHost = relayParsed.host
      relayPort = relayParsed.port
      source = 'query-relay'
    } else if (relayHostParam && isLikelyIpv4(relayHostParam)) {
      relayHost = relayHostParam
      source = 'query-ip'
    } else if (ipParam && isLikelyIpv4(ipParam)) {
      relayHost = ipParam
      source = 'query-ip'
    } else {
      const storageParsed = parseWsHostPort(storageRelay)
      if (storageParsed) {
        relayHost = storageParsed.host
        relayPort = storageParsed.port
        source = 'storage'
      } else if (storageIp && isLikelyIpv4(storageIp)) {
        relayHost = storageIp
        source = 'storage'
      } else if (ipModeEl.value === 'manual' && isLikelyIpv4(manualIpEl.value.trim())) {
        relayHost = manualIpEl.value.trim()
        source = 'manual'
      } else if (hostname && !isLoopbackHost(hostname)) {
        relayHost = hostname
        source = 'hostname'
      }
    }

    const unknownReason = relayHost ? undefined : (window.location.protocol === 'file:'
      ? 'served via file://, hostname unavailable; use ?relay=ws://<ip>:8765 or manual IP'
      : 'hostname is loopback/empty; use ?relay=ws://<ip>:8765 or manual IP')

    const relayUrl = relayHost ? `ws://${relayHost}:${relayPort}` : ''
    const aiBaseUrl = getAiBaseUrlFromStorage() || DEFAULT_AI_BASE_URL
    const webUiBaseUrl = window.location.protocol === 'file:' ? '' : window.location.origin
    const pcBaseUrl = (pcBaseParam || storagePcBase || '').trim()
    const targets = buildHealthTargets({
      aiBaseUrl,
      webUiBaseUrl,
      relayHost,
      relayPort,
      pcBaseUrl,
    })

    return {
      relayHost,
      relayPort,
      relayUrl,
      relayHealthUrl: targets.relayHealthUrl,
      aiHealthUrl: targets.aiHealthUrl,
      webUiUrl: targets.webUiUrl,
      pcHealthUrl: targets.pcHealthUrl,
      pcKind: targets.pcKind,
      source,
      unknownReason,
    }
  }


  function healthToggleStorageKey(component: 'phone' | 'pc' | 'relay' | 'backend', healthUrl: string) {
    return `${STORAGE_HEALTH_TOGGLE_PREFIX}${component}:${healthUrl || 'runtime-only'}`
  }

  function loadHealthToggle(component: 'phone' | 'pc' | 'relay' | 'backend', healthUrl: string): boolean {
    const stored = localStorage.getItem(healthToggleStorageKey(component, healthUrl))
    return stored == null ? true : stored === '1'
  }

  function saveHealthToggle(component: 'phone' | 'pc' | 'relay' | 'backend', healthUrl: string, enabled: boolean) {
    localStorage.setItem(healthToggleStorageKey(component, healthUrl), enabled ? '1' : '0')
  }

  function setComponent(component: 'phone' | 'pc' | 'relay' | 'backend', values: { ip?: string; healthUrl?: string; state?: ComponentState; details?: string }) {
    const row = root.querySelector<HTMLElement>(`[data-component="${component}"]`)
    if (!row) return
    if (values.ip != null) row.querySelector<HTMLElement>('[data-field="ip"]')!.textContent = values.ip
    if (values.healthUrl != null) row.querySelector<HTMLElement>('[data-field="healthUrl"]')!.textContent = values.healthUrl
    if (values.details != null) row.querySelector<HTMLElement>('[data-field="details"]')!.textContent = values.details
    if (values.state != null) {
      const status = row.querySelector<HTMLElement>('[data-field="status"]')!
      status.classList.remove('systemStatus--online', 'systemStatus--stale', 'systemStatus--offline', 'systemStatus--paused')
      status.classList.add(`systemStatus--${values.state}`)
    }
  }

  function renderResolved() {
    const config = resolveConfig()
    resolvedConfigEl.textContent = `Using relay ${config.relayUrl || 'unknown'} (source: ${config.source}). Fallback: query param -> localStorage -> hostname -> manual input.${config.unknownReason ? ` ${config.unknownReason}` : ''}`

    const phoneHealth = window.location.protocol === 'file:' ? 'runtime-only' : `${window.location.origin}/health + runtime state`
    const phoneIp = window.location.hostname || (window.location.protocol === 'file:' ? 'unknown (file://)' : 'unknown')
    const phoneDetails = `cameraStarted=${String(lastSignals.phoneCameraStarted)} wsConnected=${String(lastSignals.phoneWsConnected)} webrtcConnected=${String(lastSignals.phoneWebrtcConnected)}`
    const phoneState = lastSignals.phoneWebrtcConnected ? 'online' : (lastSignals.phoneWsConnected || lastSignals.phoneCameraStarted ? 'stale' : 'offline')

    const phoneEnabled = loadHealthToggle('phone', phoneHealth)
    const pcEnabled = loadHealthToggle('pc', config.pcHealthUrl)
    const relayEnabled = loadHealthToggle('relay', config.relayHealthUrl)
    const backendEnabled = loadHealthToggle('backend', config.aiHealthUrl)

    healthEnabled.phone = phoneEnabled
    healthEnabled.pc = pcEnabled
    healthEnabled.relay = relayEnabled
    healthEnabled.backend = backendEnabled

    const phoneToggle = root.querySelector<HTMLInputElement>('[data-health-toggle="phone"]')
    const pcToggle = root.querySelector<HTMLInputElement>('[data-health-toggle="pc"]')
    const relayToggle = root.querySelector<HTMLInputElement>('[data-health-toggle="relay"]')
    const backendToggle = root.querySelector<HTMLInputElement>('[data-health-toggle="backend"]')
    if (phoneToggle) phoneToggle.checked = phoneEnabled
    if (pcToggle) pcToggle.checked = pcEnabled
    if (relayToggle) relayToggle.checked = relayEnabled
    if (backendToggle) backendToggle.checked = backendEnabled

    setComponent('phone', { ip: phoneIp, healthUrl: phoneHealth, details: phoneDetails, state: phoneEnabled ? phoneState : 'paused' })
    const pcLabel = config.pcKind === 'pc' ? 'polling custom PC /health' : 'web UI check uses / (not /health)'
    setComponent('pc', { ip: window.location.hostname || 'unknown', healthUrl: config.pcKind === 'pc' ? config.pcHealthUrl : config.webUiUrl, details: pcLabel, state: pcEnabled ? 'online' : 'paused' })
    setComponent('relay', { ip: config.relayHost || 'unknown', healthUrl: config.relayHealthUrl, details: config.unknownReason ?? 'polling relay /health', state: relayEnabled ? 'offline' : 'paused' })
    setComponent('backend', { ip: (() => { try { return new URL(config.aiHealthUrl).hostname } catch { return 'unknown' } })(), healthUrl: config.aiHealthUrl, details: config.aiHealthUrl === 'runtime-only' ? 'AI server URL unavailable' : 'polling AI /health JSON', state: backendEnabled ? 'offline' : 'paused' })
  }

  function updatePhoneHtmlFromInputs() {
    setStepState('phone', 'working')
    const config = resolveConfig()
    renderResolved()

    if (!config.relayHost || isLoopbackHost(config.relayHost)) {
      const message = 'PC LAN IP is required before generating phone publisher HTML.'
      modalMetaEl.textContent = message
      modalBodyEl.textContent = ''
      root.dataset.phonePublisherHtml = ''
      setStepState('phone', 'fail', { message, details: { source: config.source, reason: config.unknownReason } })
      return
    }

    currentGeneratedPhoneHtml = buildPhonePublisherHtml(config.relayUrl)
    root.dataset.phonePublisherHtml = currentGeneratedPhoneHtml
    modalMetaEl.textContent = `Using ${config.relayUrl} from ${config.source}.`
    modalBodyEl.textContent = currentGeneratedPhoneHtml
    localStorage.setItem(STORAGE_IP_KEY, config.relayHost)
    localStorage.setItem(STORAGE_RELAY_KEY, config.relayUrl)
    setStepState('phone', 'ok')
  }

  async function refreshHealth() {
    const config = resolveConfig()
    renderResolved()

    if (healthEnabled.relay && config.relayHealthUrl !== 'runtime-only') {
      const relayResult = await pollHealth('relay', 'relay', config.relayHealthUrl)
      setComponent('relay', {
        state: relayResult.ok ? 'online' : 'offline',
        details: relayResult.ok ? 'relay /health JSON ok' : relayResult.error || 'relay health failed',
      })
      if (relayResult.ok) clearHealthFailure('relay')
      else logHealthFailureOnce('relay', relayResult)
    } else {
      globalHealthControllers.relay?.abort()
      clearHealthFailure('relay')
      setComponent('relay', { state: 'paused', details: 'health polling disabled' })
    }

    if (healthEnabled.backend && config.aiHealthUrl !== 'runtime-only') {
      const aiResult = await pollHealth('backend', 'aiServer', config.aiHealthUrl)
      setComponent('backend', {
        state: aiResult.ok ? 'online' : 'offline',
        details: aiResult.ok ? 'AI /health JSON ok' : aiResult.error || 'AI health failed',
      })
      if (aiResult.ok) clearHealthFailure('backend')
      else logHealthFailureOnce('backend', aiResult)
    } else {
      globalHealthControllers.backend?.abort()
      clearHealthFailure('backend')
      setComponent('backend', { state: 'paused', details: 'health polling disabled' })
    }

    if (healthEnabled.pc) {
      clearHealthFailure('pc')
      const pcKind: HealthKind = config.pcKind === 'pc' ? 'pc' : 'webUi'
      const pcUrl = config.pcKind === 'pc' ? config.pcHealthUrl : config.webUiUrl
      if (pcUrl !== 'runtime-only') {
        const pcResult = await pollHealth('pc', pcKind, pcUrl)
        setComponent('pc', {
          state: pcResult.ok ? 'online' : componentStateFromLastSeen(lastSignals.pc || 0),
          details: pcResult.ok
            ? (config.pcKind === 'pc' ? 'PC /health JSON ok' : 'Web UI HTML response ok')
            : pcResult.error || 'PC/Web health failed',
        })
        if (pcResult.ok) clearHealthFailure('pc')
        else logHealthFailureOnce('pc', pcResult)
      } else {
        setComponent('pc', { state: 'paused', details: 'no PC/Web URL configured' })
      }
    } else {
      globalHealthControllers.pc?.abort()
      clearHealthFailure('pc')
      setComponent('pc', { state: 'paused', details: 'health polling disabled' })
    }

    const phoneState = lastSignals.phoneWebrtcConnected ? 'online' : (lastSignals.phoneWsConnected || lastSignals.phoneCameraStarted ? 'stale' : 'offline')
    if (healthEnabled.phone) setComponent('phone', { state: phoneState })
    else {
      globalHealthControllers.phone?.abort()
      setComponent('phone', { state: 'paused', details: 'health polling disabled' })
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

    await refreshHealth()
    const relayStatus = root.querySelector('[data-component="relay"] [data-field="status"]')
    if (relayStatus?.classList.contains('systemStatus--online')) setStepState('relay', 'ok')
    else setStepState('relay', 'fail', { message: 'Relay health check failed', details: { healthUrl: resolveConfig().relayHealthUrl } })
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
      manualIpWrapEl.classList.add('hidden')
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
      void refreshHealth()
    }, 2000)
  }

  root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.addEventListener('click', () => { void openRelayModal() })
  root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.addEventListener('click', () => { void openPhoneModal() })
  ipModeEl.addEventListener('change', () => {
    manualIpWrapEl.classList.toggle('hidden', ipModeEl.value !== 'manual')
    updatePhoneHtmlFromInputs()
  })
  manualIpEl.addEventListener('input', () => { if (ipModeEl.value === 'manual') updatePhoneHtmlFromInputs() })


  for (const component of ['phone', 'pc', 'relay', 'backend'] as const) {
    const checkbox = root.querySelector<HTMLInputElement>(`[data-health-toggle="${component}"]`)
    checkbox?.addEventListener('change', () => {
      const enabled = Boolean(checkbox.checked)
      healthEnabled[component] = enabled
      const cfg = resolveConfig()
      const url = component === 'relay'
        ? cfg.relayHealthUrl
        : component === 'pc'
          ? cfg.pcHealthUrl
          : component === 'backend'
            ? cfg.aiHealthUrl
            : (window.location.protocol === 'file:' ? 'runtime-only' : `${window.location.origin}/health + runtime state`)
      saveHealthToggle(component, url, enabled)
      console.log('[WEBRTC][HEALTH] toggle changed', { component, enabled, url })
      if (!enabled) globalHealthControllers[component]?.abort()
      void refreshHealth()
    })
  }

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
    onAppEvent('WEBRTC_SIGNALING_CONNECTING', () => {
      setStepState('connect', 'working')
      lastSignals.pc = Date.now()
    }),
    onAppEvent('WEBRTC_SIGNALING_CONNECTED', (detail) => {
      setStepState('connect', 'ok')
      lastSignals.pc = Date.now()
      lastSignals.phoneWsConnected = true
      setComponent('pc', { ip: String(detail.host ?? resolveConfig().relayHost) })
      renderResolved()
    }),
    onAppEvent('WEBRTC_SIGNALING_FAILED', (detail) =>
      setStepState('connect', 'fail', {
        message: String(detail.message ?? 'Signaling connection failed.'),
        details: detail,
      }),
    ),
    onAppEvent('WEBRTC_VIEWER_READY', () => setStepState('show', 'working')),
    onAppEvent('WEBRTC_OFFER_RECEIVED', () => {
      lastSignals.phone = Date.now()
      lastSignals.phoneCameraStarted = true
      setStepState('track', 'working')
      renderResolved()
    }),
    onAppEvent('WEBRTC_REMOTE_TRACK', () => {
      lastSignals.phone = Date.now()
      lastSignals.pc = Date.now()
      lastSignals.phoneWebrtcConnected = true
      setStepState('show', 'ok')
      setStepState('track', 'ok')
      renderResolved()
    }),
    onAppEvent('WEBRTC_REMOTE_TRACK_FAILED', (detail) => {
      const message = String(detail.message ?? 'WebRTC negotiation failed.')
      setStepState('show', 'fail', { message, details: detail })
      setStepState('track', 'fail', { message, details: detail })
      lastSignals.phoneWebrtcConnected = false
      renderResolved()
    }),
  ]

  renderResolved()
  startPolling()

  root.addEventListener('DOMNodeRemoved', () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
    if (pollTimer != null) window.clearInterval(pollTimer)
  })
}
