import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mountCameraStreamTab } from '../src/tabs/camera-stream-tab'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  private handlers = new Map<string, Array<(event?: MessageEvent) => void>>()

  constructor(_url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.emit('open'))
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
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket)
  })

  it('check selected ip health button uses health helper flow and indicator', async () => {
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

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('health check passed')
    expect(root.querySelector('#scanIndicator')?.classList.contains('found')).toBe(true)
    expect(ownUrl.value).toContain('192.168.17.25:8000/detect?conf=0.25')
  })

  it('shows video stream found when signaling message contains video offer', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    const ws = FakeWebSocket.instances[0]
    ws.emit('message', { data: JSON.stringify({ type: 'offer', sdp: 'v=0\nm=video 9 UDP/TLS/RTP/SAVPF 96' }) } as MessageEvent)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#cameraSignalStatus')?.textContent).toContain('Video stream found')
  })
})
