import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mountCameraStreamTab } from '../src/tabs/camera-stream-tab'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static autoOpen = true
  static OPEN = 1
  static CLOSING = 2
  sent: string[] = []
  private handlers = new Map<string, Array<(event?: MessageEvent) => void>>()

  constructor(_url: string) {
    FakeWebSocket.instances.push(this)
    if (FakeWebSocket.autoOpen) {
      queueMicrotask(() => this.emit('open'))
    }
  }

  get readyState() {
    return 1
  }

  addEventListener(type: string, cb: (event?: MessageEvent) => void) {
    const list = this.handlers.get(type) ?? []
    list.push(cb)
    this.handlers.set(type, list)
  }

  emit(type: string, event?: MessageEvent) {
    for (const cb of this.handlers.get(type) ?? []) cb(event)
  }

  send(msg: string) {
    this.sent.push(msg)
  }

  close() {
    this.emit('close')
  }
}

class FakeRTCPeerConnection {
  static instances: FakeRTCPeerConnection[] = []
  onicecandidate: ((ev: { candidate: unknown }) => void) | null = null
  ontrack: ((ev: { streams: MediaStream[] }) => void) | null = null
  close = vi.fn()
  setRemoteDescription = vi.fn(async () => undefined)
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'fake-answer-sdp' }))
  setLocalDescription = vi.fn(async () => undefined)
  addIceCandidate = vi.fn(async () => undefined)

  constructor() {
    FakeRTCPeerConnection.instances.push(this)
  }
}

describe('camera stream tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    FakeWebSocket.instances = []
    FakeWebSocket.autoOpen = true
    FakeRTCPeerConnection.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection as unknown as typeof RTCPeerConnection)
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(async () => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
  })

  it('keeps AI server controls in dedicated section and updates health status', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('AI image recognition server health check passed')
    expect(root.querySelector('.cameraSection #ownUrl')).not.toBeNull()
    expect(root.querySelector('.signalingSection #signalingTarget')).not.toBeNull()
  })


  it('uses localhost defaults for signaling and ai detect url', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    expect(root.querySelector<HTMLInputElement>('#signalingTarget')?.value).toBe('ws://localhost:8765')
    expect(root.querySelector<HTMLInputElement>('#ownUrl')?.value).toBe('http://localhost:5175/api/detect?conf=0.25')
  })

  it('detect signaling button toggles result text on consecutive clicks', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const btn = root.querySelector<HTMLButtonElement>('#btnDetectSignaling')!
    const result = root.querySelector<HTMLSpanElement>('#detectSignalingResult')!

    btn.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.textContent).toContain('Signaling server detected')

    btn.click()
    expect(result.textContent).toBe('')
  })


  it('renders video panel above logs and clear logs clears both panes without disconnect', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const streamPanel = root.querySelector('#streamPanel') as HTMLElement
    const logsPanel = root.querySelector('#receiverLog') as HTMLElement
    expect(streamPanel.compareDocumentPosition(logsPanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const connectBtn = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
    connectBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const ws = FakeWebSocket.instances.at(-1)!

    const logEl = root.querySelector<HTMLPreElement>('#receiverLog')!
    const errEl = root.querySelector<HTMLPreElement>('#receiverError')!
    logEl.textContent = 'abc'
    errEl.textContent = 'def'

    root.querySelector<HTMLButtonElement>('#btnClearReceiverLogs')!.click()
    expect(logEl.textContent).toContain('logs cleared')
    expect(errEl.textContent).toBe('')
    expect(ws.readyState).toBe(1)
  })


  it('keeps ai detect input default on /api/detect path', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const ownUrl = root.querySelector<HTMLInputElement>('#ownUrl')!.value
    expect(ownUrl.includes('/api/detect?conf=')).toBe(true)
  })

  it('requests remote stream and displays it when offer/track arrive', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const connectBtn = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
    const showBtn = root.querySelector<HTMLButtonElement>('#btnShowVideoStream')!
    const panel = root.querySelector<HTMLDivElement>('#streamPanel')!

    connectBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(showBtn.disabled).toBe(false)

    showBtn.click()
    const ws = FakeWebSocket.instances.at(-1)!
    expect(ws.sent.some((msg) => msg.includes('viewer-ready'))).toBe(true)

    ws.emit('message', {
      data: JSON.stringify({ type: 'offer', sdp: 'fake-offer-sdp' }),
    } as MessageEvent)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(ws.sent.some((msg) => msg.includes('"answer"'))).toBe(true)

    const stream = { getTracks: () => [] } as unknown as MediaStream
    FakeRTCPeerConnection.instances[0]?.ontrack?.({ streams: [stream] })

    expect(root.querySelector('#showVideoResult')?.textContent).toContain('Remote video stream received')
  })
})
