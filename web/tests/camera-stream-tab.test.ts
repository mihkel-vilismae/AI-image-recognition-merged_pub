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
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
    FakeWebSocket.instances = []
    FakeWebSocket.autoOpen = true
    FakeRTCPeerConnection.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection as unknown as typeof RTCPeerConnection)
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(async () => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
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

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('health check passed')
    expect(root.querySelector('.cameraSection #ownUrl')).not.toBeNull()
    expect(root.querySelector('.signalingSection #signalingTarget')).not.toBeNull()
  })

  it('uses localhost defaults for signaling and AI base URL', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    expect(root.querySelector<HTMLInputElement>('#signalingTarget')?.value).toBe('ws://localhost:8765')
    expect(root.querySelector<HTMLInputElement>('#ownUrl')?.value).toBe('http://localhost:8000')
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

  it('renders controls above video and keeps video non-overlapping', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const streamPanel = root.querySelector('#streamPanel')!
    const controls = root.querySelector('#cameraControlsPanel')!
    const videoPanel = root.querySelector('#cameraVideoPanel')!

    expect(streamPanel.firstElementChild).toBe(controls)
    expect(streamPanel.lastElementChild).toBe(videoPanel)
    expect(root.querySelector('#streamPanel .videoOverlay.absolute')).toBeNull()
  })

  it('keeps ai detect requests on /api/detect path from AI base URL', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ boxes: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D))
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(new Blob(['x'], { type: 'image/jpeg' })))

    root.querySelector<HTMLButtonElement>('#btnRealtimeDetectStream')!.click()
    await new Promise((resolve) => setTimeout(resolve, 1100))

    expect(fetchMock).toHaveBeenCalled()
    const detectUrl = String(fetchMock.mock.calls[0]?.[0] ?? "")
    expect(detectUrl).toContain('http://localhost:8000/api/detect?conf=')
  })

  it('treats HTML health responses as unhealthy', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('<html>bad</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )

    root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('did not return JSON')
  })

  it('camera flip uses restart path with exact facingMode and stops old tracks', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const firstStream = {
      getTracks: () => [{ kind: 'video', id: 'first', stop: firstStop }],
      getVideoTracks: () => [{ kind: 'video', id: 'first', stop: firstStop }],
    }
    const secondStream = {
      getTracks: () => [{ kind: 'video', id: 'second', stop: secondStop }],
      getVideoTracks: () => [{ kind: 'video', id: 'second', stop: secondStop }],
    }

    const gum = vi
      .fn()
      .mockResolvedValueOnce(firstStream)
      .mockResolvedValueOnce(secondStream)

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: gum },
    })

    mountCameraStreamTab(root)

    root.querySelector<HTMLButtonElement>('#btnCameraFront')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    root.querySelector<HTMLButtonElement>('#btnCameraBack')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(gum).toHaveBeenNthCalledWith(1, { video: { facingMode: { exact: 'user' } }, audio: false })
    expect(gum).toHaveBeenNthCalledWith(2, { video: { facingMode: { exact: 'environment' } }, audio: false })
    expect(firstStop).toHaveBeenCalled()
    expect(root.querySelector('#cameraFacingState')?.textContent).toContain('back')
  })

  it('requests remote stream and displays it when offer/track arrive', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const connectBtn = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
    const showBtn = root.querySelector<HTMLButtonElement>('#btnShowVideoStream')!

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

    const stream = { getTracks: () => [{ kind: 'video', id: 'remote' }] } as unknown as MediaStream
    FakeRTCPeerConnection.instances[0]?.ontrack?.({ streams: [stream] })

    expect(root.querySelector('#showVideoResult')?.textContent).toContain('Remote video stream received')
  })
})
