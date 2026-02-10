import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emitAppEvent } from '../src/common'
import { initSinglePageApp } from '../src/main'

describe('webrtc server tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    window.location.hash = '#/webrtc-server'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
  })

  it('renders two open code buttons and status dots with health urls', async () => {
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

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()
    expect(root.querySelector('#btnCopyHtmlTop')?.classList.contains('hidden')).toBe(false)
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
