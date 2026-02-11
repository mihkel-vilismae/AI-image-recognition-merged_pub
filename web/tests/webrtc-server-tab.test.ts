import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emitAppEvent } from '../src/common'
import { initSinglePageApp } from '../src/main'

describe('webrtc server tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    document.body.innerHTML = ''
    window.location.hash = '#/webrtc-server'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/')) {
          return new Response('<!doctype html><html><body><div id="app"></div></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        return new Response(JSON.stringify({ ok: true, service: 'ai-server' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
  })

  it('renders two open code buttons, health toggles and status dots with health urls', async () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(root.querySelectorAll('.webrtcCodeBtn')).toHaveLength(2)
    expect(root.querySelector('[data-step-dot="relay"]')).toBeTruthy()
    expect(root.querySelector('[data-step-dot="phone"]')).toBeTruthy()
    expect(root.querySelectorAll('#systemPanel [data-component]').length).toBeGreaterThanOrEqual(4)

    const healthCells = Array.from(root.querySelectorAll<HTMLElement>('#systemPanel [data-field="healthUrl"]')).map((el) => el.textContent || '')
    expect(healthCells.every((cell) => cell.trim().length > 0)).toBe(true)
    expect(root.querySelectorAll('#systemPanel [data-health-toggle]').length).toBe(4)

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    expect(root.querySelector('#btnCopyHtmlTop')?.classList.contains('hidden')).toBe(false)
  })

  it('supports disabling and persisting per-row health polling state', async () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    await new Promise((resolve) => setTimeout(resolve, 0))

    const relayToggle = root.querySelector<HTMLInputElement>('[data-health-toggle="relay"]')!
    relayToggle.checked = false
    relayToggle.dispatchEvent(new Event('change'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const relayStatus = root.querySelector<HTMLElement>('[data-component="relay"] [data-field="status"]')!
    expect(relayStatus.classList.contains('systemStatus--paused')).toBe(true)

    const root2 = document.createElement('div')
    root2.id = 'app2'
    document.body.appendChild(root2)
    initSinglePageApp(root2)
    await new Promise((resolve) => setTimeout(resolve, 0))
    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    const relayToggleReloaded = root2.querySelector<HTMLInputElement>('[data-health-toggle="relay"]')!
    expect(relayToggleReloaded.checked).toBe(false)
  })

  it('treats non-json health responses as unhealthy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>nope</html>', { status: 200 })))

    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const backendStatus = root.querySelector<HTMLElement>('[data-component="backend"] [data-field="status"]')!
    expect(backendStatus.classList.contains('systemStatus--offline') || backendStatus.classList.contains('systemStatus--paused')).toBe(true)
  })


  it('never polls frontend /health and derives relay health from signaling host', async () => {
    localStorage.setItem('vidcon.signalingUrl', 'ws://localhost:8765')

    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(calledUrls.some((url) => url.includes('localhost:5173/health'))).toBe(false)

    const relayHealthCell = root.querySelector<HTMLElement>('[data-component="relay"] [data-field="healthUrl"]')
    expect(relayHealthCell?.textContent).toContain('http://localhost:8766/health')
  })


  it('marks AI health as failed when AI endpoint returns html instead of json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('8000/health')) {
          return new Response('<!doctype html><html><body>vite</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        if (url.endsWith('/')) {
          return new Response('<!doctype html><html><body><div id="app"></div></body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))

    root.querySelector<HTMLButtonElement>('[data-action="open-relay"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 20))

    const warned = warnSpy.mock.calls.some((call) => String(call[0]).includes('[HEALTH][AI]'))
    expect(warned).toBe(true)
  })

  it('updates dot colors based on emitted events', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTING', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_SIGNALING_CONNECTED', {})
    expect(root.querySelector('[data-step-dot="connect"]')?.classList.contains('step-dot--ok')).toBe(true)

    emitAppEvent('WEBRTC_VIEWER_READY', {})
    expect(root.querySelector('[data-step-dot="show"]')?.classList.contains('step-dot--working')).toBe(true)

    emitAppEvent('WEBRTC_REMOTE_TRACK', {})
    expect(root.querySelector('[data-step-dot="show"]')?.classList.contains('step-dot--ok')).toBe(true)
    expect(root.querySelector('[data-step-dot="track"]')?.classList.contains('step-dot--ok')).toBe(true)

    emitAppEvent('WEBRTC_REMOTE_TRACK_FAILED', { message: 'track error' })
    expect(root.querySelector('[data-step-dot="track"]')?.classList.contains('step-dot--fail')).toBe(true)
  })
})
