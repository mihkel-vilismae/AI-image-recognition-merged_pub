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

  it('renders WebRTC Server tab with two code buttons and local modal generation (no /api calls)', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL) => {
      return new Response(
        '<html><button id="btnFront"></button><button id="btnBack"></button><div id="log"></div><div id="error"></div>ws://__PC_LAN_IP__:8765</html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
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
    expect(root.querySelector('#webrtcCodeModalBody')?.textContent).toContain('tools/webrtc-relay/server.py')
    expect(root.querySelector('#webrtcCodeModalBody')?.textContent).toContain('WebSocket relay listening on ws://0.0.0.0:8765')

    root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')?.click()

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    for (let i = 0; i < 5; i++) {
      if (fetchSpy.mock.calls.length > 0) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(fetchSpy.mock.calls.some((call) => String(call[0]).includes('/api/webrtc/'))).toBe(false)

    for (let i = 0; i < 5; i++) {
      const text = root.querySelector('#webrtcCodeModalBody')?.textContent || ''
      if (text.includes('ws://127.0.0.1:8765')) break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const tabView = root.querySelector<HTMLElement>('#tabView')
    const phoneHtml = tabView?.dataset.phonePublisherHtml || root.querySelector('#webrtcCodeModalBody')?.textContent || ''
    expect(phoneHtml).toContain('ws://127.0.0.1:8765')
    expect(phoneHtml).not.toContain('__PC_LAN_IP__')
    expect(phoneHtml).toContain('btnFront')
    expect(phoneHtml).toContain('btnBack')
    expect(phoneHtml).toContain('id="log"')
    expect(phoneHtml).toContain('id="error"')
  })

  it('updates checklist dot states from prefixed events and shows error modal on failure', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.querySelectorAll('.step-dot--idle').length).toBe(5)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTING', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTED', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--ok')).toBe(true)

    emitAppEvent('WEBRTC_VIEWER_READY_SENT', {})
    expect(root.querySelector('[data-step-dot="show"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_NEGOTIATION_FAILED', { message: 'timeout waiting for remote track', details: { timeoutMs: 5000 } })
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
