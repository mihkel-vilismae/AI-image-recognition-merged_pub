import { beforeEach, describe, expect, it, vi } from 'vitest'

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



  it('renders WebRTC Server tab next to Camera Stream and mounts its view', () => {
    const root = document.createElement('div')
    root.id = 'app'
    document.body.appendChild(root)

    initSinglePageApp(root)

    const tabRoutes = Array.from(root.querySelectorAll<HTMLAnchorElement>('.tabLink')).map((el) => el.dataset.route)
    expect(tabRoutes).toEqual(['images', 'videos', 'camera-stream', 'webrtc-server'])

    window.location.hash = '#/webrtc-server'
    window.dispatchEvent(new HashChangeEvent('hashchange'))

    expect(root.querySelector('h1')?.textContent).toContain('WebRTC Server')
    expect(root.textContent).toContain('phone → signaling server → Camera Stream')
    expect(root.querySelector<HTMLAnchorElement>('[data-route="webrtc-server"]')?.dataset.active).toBe('true')

    const codeButtons = root.querySelectorAll<HTMLButtonElement>('.webrtcCodeBtn')
    expect(codeButtons.length).toBe(4)

    codeButtons[0]?.click()
    expect(root.querySelector('#webrtcCodeModal')?.classList.contains('hidden')).toBe(false)
    expect(root.querySelector('#webrtcCodeModalBody')?.textContent).toContain('python server.py')

    root.querySelector<HTMLButtonElement>('#btnCloseWebrtcCodeModal')?.click()
    expect(root.querySelector('#webrtcCodeModal')?.classList.contains('hidden')).toBe(true)
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
