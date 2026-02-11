import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mountVidconMonitorTab } from '../src/tabs/vidcon-monitor-tab'
import { createVidconMonitorEngine } from '../src/tabs/vidcon-monitor-engine'

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static shouldOpen = true
  readyState = FakeWebSocket.CONNECTING
  private handlers = new Map<string, Array<(event?: MessageEvent) => void>>()

  constructor(_url: string) {
    if (FakeWebSocket.shouldOpen) {
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN
        this.emit('open')
      })
    } else {
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.CLOSED
        this.emit('error')
        this.emit('close')
      })
    }
  }

  addEventListener(type: string, cb: (event?: MessageEvent) => void) {
    const list = this.handlers.get(type) ?? []
    list.push(cb)
    this.handlers.set(type, list)
  }

  emit(type: string, event?: MessageEvent) {
    for (const cb of this.handlers.get(type) ?? []) cb(event)
  }

  send(_msg: string) {}
  close() {
    this.readyState = FakeWebSocket.CLOSED
  }
}

describe('VidConMonitor tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    FakeWebSocket.shouldOpen = true
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.stubGlobal('RTCPeerConnection', class {
      connectionState = 'new'
      iceConnectionState = 'new'
      onicecandidate: ((ev: { candidate: unknown }) => void) | null = null
      ontrack: ((ev: { streams: MediaStream[] }) => void) | null = null
      close() {}
      async setRemoteDescription() {}
      async createAnswer() { return { sdp: 'sdp' } }
      async setLocalDescription() {}
      async addIceCandidate() {}
    } as unknown as typeof RTCPeerConnection)
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(async () => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  })

  it('renders all required blocks with initial state labels', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountVidconMonitorTab(root)

    expect(root.querySelector('h1')?.textContent).toContain('VidConMonitor')
    expect(root.querySelectorAll('.vidconBlock').length).toBe(8)
    expect(root.querySelector('.vidconBlock .vidconState')?.textContent).toBeTruthy()
  })

  it('dependency logic prevents OK when signaling fails', async () => {
    FakeWebSocket.shouldOpen = false
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountVidconMonitorTab(root)

    await new Promise((resolve) => setTimeout(resolve, 30))

    const signalingState = root.querySelector<HTMLElement>('[data-block="signalingRelayReachable"] .vidconState')!
    const dependentState = root.querySelector<HTMLElement>('[data-block="webrtcOfferAnswerCompleted"] .vidconState')!
    expect(['CHECKING', 'FAIL']).toContain(signalingState.textContent)
    expect(dependentState.textContent).not.toBe('OK')
  })

  it('checker exceptions are captured as FAIL', async () => {
    const updates: Array<Record<string, unknown>> = []
    const video = document.createElement('video')
    const fetchMock = vi.fn(async () => {
      throw new Error('boom')
    })
    vi.stubGlobal('fetch', fetchMock)

    const engine = createVidconMonitorEngine({
      videoEl: video,
      onUpdate: (snapshot) => updates.push(snapshot as unknown as Record<string, unknown>),
    })

    await engine.runOnceForTests()
    const last = updates.at(-1) as any
    expect(last.aiServerHealthy.state).toBe('FAIL')
    expect(String(last.aiServerHealthy.detail)).toContain('health check failed')
  })
})
