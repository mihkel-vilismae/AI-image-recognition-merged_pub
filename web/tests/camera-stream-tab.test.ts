import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mountCameraStreamTab } from '../src/tabs/camera-stream-tab'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static autoOpen = true
  private handlers = new Map<string, Array<(event?: MessageEvent) => void>>()

  constructor(_url: string) {
    FakeWebSocket.instances.push(this)
    if (FakeWebSocket.autoOpen) {
      queueMicrotask(() => this.emit('open'))
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

  close() {
    this.emit('close')
  }
}

describe('camera stream tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    FakeWebSocket.instances = []
    FakeWebSocket.autoOpen = true
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)

    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(async () => undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
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

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('AI image recognition server health check passed')
    expect(root.querySelector('.cameraSection #ownUrl')).not.toBeNull()
    expect(root.querySelector('.signalingSection #signalingTarget')).not.toBeNull()
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

  it('connect signaling does not auto-show stream and enables show-video button', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const connectBtn = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
    const showBtn = root.querySelector<HTMLButtonElement>('#btnShowVideoStream')!
    const panel = root.querySelector<HTMLDivElement>('#streamPanel')!

    expect(showBtn.disabled).toBe(true)
    expect(panel.classList.contains('hidden')).toBe(true)

    connectBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 900))

    expect(showBtn.disabled).toBe(false)
    expect(panel.classList.contains('hidden')).toBe(true)

    showBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel.classList.contains('hidden')).toBe(false)

    connectBtn.click()
    expect(showBtn.disabled).toBe(true)
    expect(panel.classList.contains('hidden')).toBe(true)
  })
})
