import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emitAppEvent } from '../src/common'
import { initSinglePageApp } from '../src/main'

describe('webrtc server tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    window.location.hash = '#/webrtc-server'
  })

  it('renders two open code buttons and status dots', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    expect(root.querySelectorAll('.webrtcCodeBtn')).toHaveLength(2)
    expect(root.querySelector('[data-step-dot="relay"]')).toBeTruthy()
    expect(root.querySelector('[data-step-dot="phone"]')).toBeTruthy()
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
