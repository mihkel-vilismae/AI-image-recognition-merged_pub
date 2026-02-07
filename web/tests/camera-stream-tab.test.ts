import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mountCameraStreamTab } from '../src/tabs/camera-stream-tab'

describe('camera stream tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('check selected ip health button uses health helper flow', async () => {
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
    expect(ownUrl.value).toContain('192.168.17.25:8000/detect?conf=0.25')
  })

  it('scan local network button updates url and status when a host is found', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountCameraStreamTab(root)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('192.168.17.30:8000/health')) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        return new Response('fail', { status: 500 })
      }),
    )

    const ownUrl = root.querySelector<HTMLInputElement>('#ownUrl')!
    ownUrl.value = 'http://192.168.17.30:8000/detect?conf=0.25'

    root.querySelector<HTMLButtonElement>('#btnScanOwnServer')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelector('#cameraStreamStatus')?.textContent).toContain('own server found')
    expect(ownUrl.value).toContain('192.168.17.30:8000/detect?conf=0.25')
  })
})
