import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initSinglePageApp } from '../src/main'

describe('phone publisher html generation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    window.location.hash = '#/webrtc-server'
  })

  it('requires manual ip when running on localhost and generates valid ws html', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    root.querySelector<HTMLButtonElement>('[data-action="open-phone"]')?.click()

    expect(root.querySelector('[data-step-dot="phone"]')?.classList.contains('step-dot--fail')).toBe(true)

    const ipMode = root.querySelector<HTMLSelectElement>('#webrtcIpMode')!
    const manualIp = root.querySelector<HTMLInputElement>('#webrtcManualIp')!

    ipMode.value = 'manual'
    ipMode.dispatchEvent(new Event('change'))

    manualIp.value = '192.168.0.55'
    manualIp.dispatchEvent(new Event('input'))

    const tabView = root.querySelector<HTMLElement>('#tabView')!
    const html = tabView.dataset.phonePublisherHtml || ''

    expect(html).toContain('ws://192.168.0.55:8765')
    expect(html).not.toContain('__PC_LAN_IP__')
    expect(html).toContain('id="btnStart"')
    expect(html).toContain('id="log"')
    expect(html).toContain('id="error"')

    expect(html).toContain('remoteAnswerApplied = false')
    expect(html).toContain('duplicate answer ignored')
    expect(html).toContain('applyRemoteAnswerOnce')
    expect(html).toContain('markOfferCreated')
    expect(html).toContain('answer ignored due to signalingState')
    expect(html).toContain('pendingRemoteCandidates.push')
    expect(html).toContain('queued candidates flushed')
    expect(root.querySelector('[data-step-dot="phone"]')?.classList.contains('step-dot--ok')).toBe(true)
  })
})
