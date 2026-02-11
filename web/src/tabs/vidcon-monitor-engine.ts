import { buildHealthUrl, normalizeAiBaseUrl } from './camera-stream-utils'
import { getAiBaseUrlFromStorage, getSignalingUrlFromStorage } from './shared-config'

export const VIDCON_POLL_MS = 1500
const HEARTBEAT_MAX_AGE_MS = 5000
const HEALTH_TIMEOUT_MS = 1200
export const MAX_HISTORY_ENTRIES = 200

export type MonitorState = 'NOT_STARTED' | 'CHECKING' | 'OK' | 'FAIL' | 'DISABLED'
export type HistoryLevel = 'INFO' | 'OK' | 'FAIL' | 'DEBUG'

export type HistoryEntry = {
  ts: number
  level: HistoryLevel
  message: string
}

export type MonitorBlockId =
  | 'signalingRelayReachable'
  | 'phonePublisherPageLoaded'
  | 'phoneCameraActive'
  | 'webrtcOfferAnswerCompleted'
  | 'webrtcPeerConnectionConnected'
  | 'remoteVideoTrackReceived'
  | 'videoElementRendering'
  | 'aiServerHealthy'

export type MonitorBlock = {
  id: MonitorBlockId
  title: string
  state: MonitorState
  detail: string
  dependencies: MonitorBlockId[]
  lastCheckedAt: number | null
  lastOkAt: number | null
  lastError: string | null
  history: HistoryEntry[]
}

type Snapshot = Record<MonitorBlockId, MonitorBlock>

function makeBlock(id: MonitorBlockId, title: string, dependencies: MonitorBlockId[] = []): MonitorBlock {
  return {
    id,
    title,
    dependencies,
    state: 'NOT_STARTED',
    detail: 'not started',
    lastCheckedAt: null,
    lastOkAt: null,
    lastError: null,
    history: [],
  }
}

function initialSnapshot(): Snapshot {
  return {
    signalingRelayReachable: makeBlock('signalingRelayReachable', 'Signaling Relay Reachable'),
    phonePublisherPageLoaded: makeBlock('phonePublisherPageLoaded', 'Phone Publisher Page Loaded', ['signalingRelayReachable']),
    phoneCameraActive: makeBlock('phoneCameraActive', 'Phone Camera Active', ['phonePublisherPageLoaded']),
    webrtcOfferAnswerCompleted: makeBlock('webrtcOfferAnswerCompleted', 'WebRTC Offer/Answer Completed', ['signalingRelayReachable']),
    webrtcPeerConnectionConnected: makeBlock('webrtcPeerConnectionConnected', 'WebRTC PeerConnection Connected', ['webrtcOfferAnswerCompleted']),
    remoteVideoTrackReceived: makeBlock('remoteVideoTrackReceived', 'Remote Video Track Received', ['webrtcPeerConnectionConnected']),
    videoElementRendering: makeBlock('videoElementRendering', 'Video Element Rendering', ['remoteVideoTrackReceived']),
    aiServerHealthy: makeBlock('aiServerHealthy', 'AI Server Healthy'),
  }
}

type CheckerResult = { state: MonitorState; detail: string; error?: string | null }

type EngineOptions = {
  onUpdate: (snapshot: Snapshot) => void
  videoEl: HTMLVideoElement
}

function compactError(error: unknown): string {
  const raw = String(error)
  return raw.replace(/\s+/g, ' ').slice(0, 180)
}

export function createVidconMonitorEngine({ onUpdate, videoEl }: EngineOptions) {
  const snapshot = initialSnapshot()
  let timer: number | null = null
  let ws: WebSocket | null = null
  let wsError: string | null = null
  let pc: RTCPeerConnection | null = null
  let lastHeartbeatAt = 0
  let heartbeatPayload: Record<string, unknown> | null = null
  let offerSeen = false
  let answerSent = false
  let remoteTrackLive = false
  let renderSampleTime = 0
  let lastTransitionState: Partial<Record<MonitorBlockId, MonitorState>> = {}

  function pushHistory(blockId: MonitorBlockId, level: HistoryLevel, message: string) {
    const block = snapshot[blockId]
    block.history.push({ ts: Date.now(), level, message: message.slice(0, 220) })
    if (block.history.length > MAX_HISTORY_ENTRIES) {
      block.history.splice(0, block.history.length - MAX_HISTORY_ENTRIES)
    }
  }

  function notify() {
    onUpdate(structuredClone(snapshot))
  }

  function transition(blockId: MonitorBlockId, next: CheckerResult) {
    const block = snapshot[blockId]
    const prev = block.state
    block.state = next.state
    block.detail = next.detail
    block.lastCheckedAt = Date.now()
    block.lastError = next.error ?? null
    if (next.state === 'OK') block.lastOkAt = Date.now()

    if (lastTransitionState[blockId] !== next.state) {
      lastTransitionState[blockId] = next.state
      if (prev !== next.state) {
        console.info(`[VIDCON] ${block.title} ${prev} -> ${next.state}`)
        pushHistory(blockId, next.state === 'FAIL' ? 'FAIL' : 'INFO', `state ${prev} -> ${next.state}`)
      }
    }
  }

  function hasFailedDependency(block: MonitorBlock): string | null {
    for (const dep of block.dependencies) {
      if (snapshot[dep].state !== 'OK') return snapshot[dep].title
    }
    return null
  }

  function ensureWebSocket() {
    const signalingUrl = getSignalingUrlFromStorage().trim()
    if (!signalingUrl) return
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

    wsError = null
    pushHistory('signalingRelayReachable', 'INFO', `WS connect attempt to ${signalingUrl}`)
    try {
      ws = new WebSocket(signalingUrl)
    } catch (error) {
      wsError = compactError(error)
      pushHistory('signalingRelayReachable', 'FAIL', `WS constructor failed: ${wsError}`)
      return
    }

    ws.addEventListener('open', () => {
      pushHistory('signalingRelayReachable', 'OK', 'WS open')
    })

    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      if (payload.type === 'publisher_heartbeat') {
        lastHeartbeatAt = Date.now()
        heartbeatPayload = payload
        pushHistory('phonePublisherPageLoaded', 'OK', 'heartbeat received from publisher')
      }

      if (payload.type === 'offer' && typeof payload.sdp === 'string') {
        offerSeen = true
        pushHistory('webrtcOfferAnswerCompleted', 'INFO', 'offer received')
        void handleOffer(payload.sdp)
      }

      if (payload.type === 'candidate' && payload.candidate && pc) {
        void pc.addIceCandidate(payload.candidate as RTCIceCandidateInit).catch(() => {})
      }
    })

    ws.addEventListener('error', () => {
      wsError = 'WS error'
      pushHistory('signalingRelayReachable', 'FAIL', wsError)
    })

    ws.addEventListener('close', () => {
      wsError = 'WS closed'
      pushHistory('signalingRelayReachable', 'FAIL', wsError)
    })
  }

  function send(payload: Record<string, unknown>) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  function ensurePc() {
    if (pc) return pc
    pc = new RTCPeerConnection()
    pushHistory('webrtcPeerConnectionConnected', 'INFO', 'peer connection created')

    pc.onicecandidate = (event) => {
      if (!event.candidate) return
      send({ type: 'candidate', candidate: event.candidate })
    }

    pc.addEventListener('connectionstatechange', () => {
      pushHistory('webrtcPeerConnectionConnected', 'INFO', `pc state ${pc?.connectionState || 'unknown'}`)
    })

    pc.addEventListener('iceconnectionstatechange', () => {
      pushHistory('webrtcPeerConnectionConnected', 'INFO', `ice state ${pc?.iceConnectionState || 'unknown'}`)
    })

    pc.ontrack = async (event) => {
      const stream = event.streams[0] ?? null
      if (!stream) return
      remoteTrackLive = stream.getVideoTracks().some((track) => track.readyState === 'live')
      pushHistory('remoteVideoTrackReceived', remoteTrackLive ? 'OK' : 'INFO', `ontrack fired (live=${String(remoteTrackLive)})`)

      try {
        videoEl.srcObject = stream
        pushHistory('videoElementRendering', 'INFO', 'video srcObject set')
      } catch (error) {
        pushHistory('videoElementRendering', 'FAIL', `video srcObject failed: ${compactError(error)}`)
        return
      }

      pushHistory('videoElementRendering', 'INFO', 'video play() attempt')
      try {
        await videoEl.play()
        pushHistory('videoElementRendering', 'OK', 'video play() succeeded')
      } catch (error) {
        pushHistory('videoElementRendering', 'FAIL', `video play() failed: ${compactError(error)}`)
      }
    }
    return pc
  }

  async function handleOffer(sdp: string) {
    try {
      const peer = ensurePc()
      await peer.setRemoteDescription({ type: 'offer', sdp })
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      send({ type: 'answer', sdp: answer.sdp })
      answerSent = true
      pushHistory('webrtcOfferAnswerCompleted', 'OK', 'answer sent')
    } catch (error) {
      wsError = `offer/answer failed: ${compactError(error)}`
      pushHistory('webrtcOfferAnswerCompleted', 'FAIL', wsError)
    }
  }

  async function checkSignaling(): Promise<CheckerResult> {
    const signalingUrl = getSignalingUrlFromStorage().trim()
    if (!signalingUrl) return { state: 'FAIL', detail: 'missing signaling URL in config', error: 'missing signaling URL' }

    ensureWebSocket()

    if (!ws) return { state: 'FAIL', detail: wsError || 'cannot create websocket', error: wsError || 'cannot create websocket' }
    if (ws.readyState === WebSocket.CONNECTING) return { state: 'CHECKING', detail: `connecting ${signalingUrl}` }
    if (ws.readyState === WebSocket.OPEN) return { state: 'OK', detail: `connected ${signalingUrl}` }
    return { state: 'FAIL', detail: wsError || 'not connected', error: wsError || 'not connected' }
  }

  function checkHeartbeat(): CheckerResult {
    if (!lastHeartbeatAt) return { state: 'FAIL', detail: 'no heartbeat seen from phone publisher', error: 'no heartbeat' }
    const ageMs = Date.now() - lastHeartbeatAt
    if (ageMs > HEARTBEAT_MAX_AGE_MS) {
      return { state: 'FAIL', detail: `heartbeat stale (${ageMs}ms)`, error: 'stale heartbeat' }
    }
    return { state: 'OK', detail: `last heartbeat ${ageMs}ms ago` }
  }

  function checkPhoneCamera(): CheckerResult {
    const camera = (heartbeatPayload?.camera as Record<string, unknown> | undefined) || {}
    const active = camera.active === true
    const trackLive = camera.trackReadyState === 'live'
    if (!active || !trackLive) {
      return { state: 'FAIL', detail: 'camera inactive/not live on phone', error: 'camera inactive' }
    }
    const width = camera.width ? ` ${camera.width}x${camera.height}` : ''
    return { state: 'OK', detail: `active${width}` }
  }

  function checkOfferAnswer(): CheckerResult {
    if (!offerSeen && !answerSent) return { state: 'NOT_STARTED', detail: 'waiting for offer' }
    if (offerSeen && answerSent) return { state: 'OK', detail: 'offer seen + answer sent' }
    return { state: 'CHECKING', detail: 'negotiation in progress' }
  }

  function checkPeer(): CheckerResult {
    if (!pc) return { state: 'NOT_STARTED', detail: 'no peer connection yet' }
    if (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      return { state: 'OK', detail: `pc=${pc.connectionState}, ice=${pc.iceConnectionState}` }
    }
    if (pc.connectionState === 'failed' || pc.iceConnectionState === 'failed') {
      return { state: 'FAIL', detail: `pc=${pc.connectionState}, ice=${pc.iceConnectionState}`, error: 'peer failed' }
    }
    return { state: 'CHECKING', detail: `pc=${pc.connectionState}, ice=${pc.iceConnectionState}` }
  }

  function checkRemoteTrack(): CheckerResult {
    if (remoteTrackLive) return { state: 'OK', detail: 'live remote video track received' }
    return { state: 'NOT_STARTED', detail: 'remote track not received yet' }
  }

  function checkVideoRendering(): CheckerResult {
    if (!videoEl.srcObject) return { state: 'NOT_STARTED', detail: 'video has no srcObject' }
    if (videoEl.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return { state: 'CHECKING', detail: `readyState=${videoEl.readyState}` }
    }
    const current = videoEl.currentTime
    const progressing = current > renderSampleTime
    renderSampleTime = current
    if (progressing || current > 0) return { state: 'OK', detail: `rendering t=${current.toFixed(2)}s` }
    return { state: 'CHECKING', detail: 'waiting for frames' }
  }

  async function checkAiHealth(): Promise<CheckerResult> {
    const aiBase = normalizeAiBaseUrl(getAiBaseUrlFromStorage())
    if (!aiBase) return { state: 'FAIL', detail: 'missing AI base URL config', error: 'missing ai base url' }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    pushHistory('aiServerHealthy', 'INFO', `fetch ${buildHealthUrl(aiBase)}`)
    try {
      const res = await fetch(buildHealthUrl(aiBase), { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (!res.ok) return { state: 'FAIL', detail: `HTTP ${res.status}`, error: `http_${res.status}` }
      const contentType = (res.headers.get('content-type') || '').toLowerCase()
      if (!contentType.includes('application/json')) return { state: 'FAIL', detail: 'health returned non-JSON', error: 'non-json health' }
      const payload = (await res.json()) as Record<string, unknown>
      if (payload.ok === true) return { state: 'OK', detail: `healthy ${aiBase}` }
      return { state: 'FAIL', detail: 'health payload missing ok=true', error: 'bad health payload' }
    } catch (error) {
      return { state: 'FAIL', detail: `health check failed: ${compactError(error)}`, error: compactError(error) }
    } finally {
      window.clearTimeout(timeout)
    }
  }

  async function tick() {
    const signaling = await checkSignaling()
    transition('signalingRelayReachable', signaling)

    const ordered: Array<[MonitorBlockId, () => CheckerResult | Promise<CheckerResult>]> = [
      ['phonePublisherPageLoaded', checkHeartbeat],
      ['phoneCameraActive', checkPhoneCamera],
      ['webrtcOfferAnswerCompleted', checkOfferAnswer],
      ['webrtcPeerConnectionConnected', checkPeer],
      ['remoteVideoTrackReceived', checkRemoteTrack],
      ['videoElementRendering', checkVideoRendering],
      ['aiServerHealthy', checkAiHealth],
    ]

    for (const [id, checker] of ordered) {
      const block = snapshot[id]
      const failedDep = hasFailedDependency(block)
      if (failedDep) {
        transition(id, { state: 'NOT_STARTED', detail: `blocked by dependency: ${failedDep}` })
        pushHistory(id, 'INFO', `skipped (dependency not OK: ${failedDep})`)
        continue
      }

      pushHistory(id, 'INFO', 'check start')
      try {
        const result = await checker()
        transition(id, result)
        pushHistory(id, result.state === 'FAIL' ? 'FAIL' : result.state === 'OK' ? 'OK' : 'INFO', `check result: ${result.detail}`)
      } catch (error) {
        const msg = compactError(error)
        transition(id, { state: 'FAIL', detail: `checker failed: ${msg}`, error: msg })
        pushHistory(id, 'FAIL', `checker threw: ${msg}`)
      }
    }

    notify()
  }

  return {
    start() {
      if (timer != null) return
      void tick()
      timer = window.setInterval(() => {
        void tick()
      }, VIDCON_POLL_MS)
    },
    stop() {
      if (timer != null) {
        window.clearInterval(timer)
        timer = null
      }
      if (ws) {
        try {
          ws.close()
        } catch {}
        ws = null
      }
      if (pc) {
        try {
          pc.close()
        } catch {}
        pc = null
      }
      if (videoEl.srcObject) videoEl.srcObject = null
    },
    clearHistory(blockId: MonitorBlockId) {
      snapshot[blockId].history = []
      notify()
    },
    getSnapshot() {
      return structuredClone(snapshot)
    },
    addHistoryForTests(blockId: MonitorBlockId, level: HistoryLevel, message: string) {
      pushHistory(blockId, level, message)
    },
    runOnceForTests: tick,
  }
}
