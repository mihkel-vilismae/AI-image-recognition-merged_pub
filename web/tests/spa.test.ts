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

    // After switching to camera stream tab, ensure the camera UI loads
    expect(root.textContent).toContain('AI Camera Stream Recognition')
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