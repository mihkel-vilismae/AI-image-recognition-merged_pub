import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emitAppEvent } from '../src/common'
import { initSinglePageApp } from '../src/main'

describe('single page tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    window.location.hash = ''

    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn(),
    })

    const fakeCtx = {
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 42 })),
      font: '',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx)
  })

  it('defaults to images and updates tab content when hash changes', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    expect(window.location.hash).toBe('#/images')
    expect(root.querySelector('h1')?.textContent).toContain('AI Image Recognition')

    window.location.hash = '#/camera-stream'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.textContent).toContain('hello camera stream')
  })

  it('renders WebRTC Server tab with two code buttons and modal content from backend endpoints', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : String((input as Request).url ?? input)
        if (url.includes('/api/webrtc/relay-info')) {
          return new Response(
            JSON.stringify({
              relayPath: '/workspace/AI-image-recognition-merged/server/server.py',
              relayExists: true,
              runCommands: ['cd /workspace/AI-image-recognition-merged/server', 'python server.py'],
              relayCode: 'print("relay")',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        return new Response(
          JSON.stringify({
            ipCandidates: ['10.0.0.5', '192.168.1.22'],
            selectedIp: '10.0.0.5',
            warning: false,
            html: '<html><button id="btnFront"></button><button id="btnBack"></button><div id="log"></div><div id="error"></div>ws://10.0.0.5:8765</html>',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      })
    vi.stubGlobal('fetch', fetchSpy)

    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    const tabRoutes = Array.from(root.querySelectorAll<HTMLAnchorElement>('.tabLink')).map((el) => el.dataset.route)
    expect(tabRoutes).toEqual(['images', 'videos', 'camera-stream', 'webrtc-server'])

    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.querySelector('h1')?.textContent).toContain('WebRTC Server')
    expect(root.querySelector<HTMLAnchorElement>('[data-route="webrtc-server"]')?.dataset.active).toBe('true')

    const codeButtons = root.querySelectorAll<HTMLButtonElement>('.webrtcCodeBtn')
    expect(codeButtons.length).toBe(2)

    root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/api/webrtc/relay-info'))).toBe(true)

    root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')?.click()

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    for (let i = 0; i < 5; i++) {
      const text = root.querySelector('#webrtcCodeModalBody')?.textContent || ''
      if (text.includes('ws://10.0.0.5:8765')) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/api/webrtc/phone-publisher'))).toBe(true)

    const phoneHtml = root.querySelector('#webrtcCodeModalBody')?.textContent || ''
    expect(phoneHtml).toContain('ws://10.0.0.5:8765')
    expect(phoneHtml).not.toContain('PC_LAN_IP')
    expect(phoneHtml).toContain('btnFront')
    expect(phoneHtml).toContain('btnBack')
    expect(phoneHtml).toContain('id="log"')
    expect(phoneHtml).toContain('id="error"')
  })

  it('updates checklist dot states from app events and shows error modal on failure', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.querySelectorAll('.step-dot--idle').length).toBe(5)

    emitAppEvent('SIGNALING_CONNECTING', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('SIGNALING_CONNECTED', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--ok')).toBe(true)

    emitAppEvent('VIEWER_READY_SENT', {})
    expect(root.querySelector('[data-step-dot="show"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('REMOTE_TRACK_FAILED', { message: 'timeout waiting for remote track', details: { timeoutMs: 5000 } })
    const trackLine = root.querySelector<HTMLElement>('[data-step-line="track"]')!
    expect(root.querySelector('[data-step-dot="track"]')?.classList.contains('step-dot--fail')).toBe(true)
    expect(trackLine.classList.contains('webrtcStepLine--clickable')).toBe(true)

    trackLine.click()
    expect(root.querySelector('#webrtcErrorModal')?.classList.contains('hidden')).toBe(false)
    expect(root.querySelector('#webrtcErrorModalBody')?.textContent).toContain('timeout waiting for remote track')
  })

  it('marks selected tab active', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    window.location.hash = '#/videos'
    initSinglePageApp(root)

    expect(root.querySelector<HTMLAnchorElement>('[data-route="videos"]')?.dataset.active).toBe('true')
    expect(root.querySelector('h1')?.textContent).toContain('AI Video Recognition')
  })
})
