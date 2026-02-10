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

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

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

  it('renders WebRTC Server tab with two code buttons and local modal generation', async () => {
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
    expect(root.querySelector('#systemPanel')).toBeTruthy()
    expect(root.querySelectorAll('#systemPanel [data-component]').length).toBeGreaterThanOrEqual(4)

    const healthCells = root.querySelectorAll<HTMLElement>('#systemPanel [data-field="healthUrl"]')
    expect(Array.from(healthCells).every((el) => (el.textContent || '').trim().length > 0)).toBe(true)

    const codeButtons = root.querySelectorAll<HTMLButtonElement>('.webrtcCodeBtn')
    expect(codeButtons.length).toBe(2)

    root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.click()
    expect(root.querySelector('#webrtcCodeModalBody')?.textContent).toContain('tools/webrtc-relay/server.py')
    expect(root.querySelector('#webrtcCodeModalBody')?.textContent).toContain('Health endpoint listening on http://0.0.0.0:{HEALTH_PORT}/health')

    root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')?.click()

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    expect(root.querySelector('#webrtcCodeModal .webrtcCodeTopActions #btnCopyHtmlTop')).toBeTruthy()

    const ipMode = root.querySelector<HTMLSelectElement>('#webrtcIpMode')!
    const manualIp = root.querySelector<HTMLInputElement>('#webrtcManualIp')!
    ipMode.value = 'manual'
    ipMode.dispatchEvent(new Event('change'))
    manualIp.value = '192.168.1.20'
    manualIp.dispatchEvent(new Event('input'))

    const tabView = root.querySelector<HTMLElement>('#tabView')
    const phoneHtml = tabView?.dataset.phonePublisherHtml || root.querySelector('#webrtcCodeModalBody')?.textContent || ''
    expect(phoneHtml).toContain('ws://192.168.1.20:8765')
    expect(phoneHtml).toContain('push("ERR"')
    expect(phoneHtml).toContain('window.onerror')
  })

  it('updates checklist dot states from prefixed events and shows error modal on failure', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.querySelectorAll('.step-dot--idle').length).toBeGreaterThanOrEqual(4)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTING', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTED', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--ok')).toBe(true)

    emitAppEvent('WEBRTC_VIEWER_READY', {})
    expect(root.querySelector('[data-step-dot="show"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_REMOTE_TRACK_FAILED', { message: 'timeout waiting for remote track', details: { timeoutMs: 5000 } })
    const trackLine = root.querySelector<HTMLElement>('[data-step-line="track"]')!
    expect(root.querySelector('[data-step-dot="track"]')?.classList.contains('step-dot--fail')).toBe(true)
    expect(trackLine.classList.contains('webrtcStepLine--clickable')).toBe(true)

    trackLine.click()
    expect(root.querySelector('#webrtcErrorModal')?.classList.contains('hidden')).toBe(false)
    expect(root.querySelector('#webrtcErrorModalBody')?.textContent).toContain('timeout waiting for remote track')
  })

  it('uses query ip override for generated phone html', () => {
    window.history.replaceState({}, '', '/?ip=1.2.3.4#/webrtc-server')
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    const html = root.querySelector<HTMLElement>('#tabView')?.dataset.phonePublisherHtml || ''
    expect(html).toContain('ws://1.2.3.4:8765')
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
