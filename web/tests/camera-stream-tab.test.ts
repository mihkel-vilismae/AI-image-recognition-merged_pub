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

  it('health button applies to AI server URL flow and sets found indicator', async () => {
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

    const ownUrl = root.querySelector<HTMLInputElement>('#ownUrl')!
    ownUrl.value = 'http://192.168.17.25:8000/detect?conf=0.25'

    root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('AI image recognition server health check passed')
    expect(root.querySelector('#scanIndicator')?.classList.contains('found')).toBe(true)
    expect(ownUrl.value).toContain('192.168.17.25:8000/detect?conf=0.25')
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

  it('connect signaling button opens stream panel and toggles off on second click', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const btn = root.querySelector<HTMLButtonElement>('#btnConnectSignaling')!
    const panel = root.querySelector<HTMLDivElement>('#streamPanel')!

    expect(panel.classList.contains('hidden')).toBe(true)

    btn.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(panel.classList.contains('hidden')).toBe(false)
    expect(btn.textContent).toContain('Disconnect')

    btn.click()
    expect(panel.classList.contains('hidden')).toBe(true)
    expect(btn.textContent).toContain('Connect')
  })
})
