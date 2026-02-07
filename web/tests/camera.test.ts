import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initCameraApp } from '../src/camera'

describe('camera stream tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    // Stub URL functions used by the app
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test-url'),
      revokeObjectURL: vi.fn(),
    })
    // Stub canvas context to avoid crashes in jsdom
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

  it('renders required controls and enables/disables detection buttons based on stream state', async () => {
    const root = document.createElement('div')
    initCameraApp(root)

    const startStream = root.querySelector<HTMLButtonElement>('#startStream')!
    const pauseStream = root.querySelector<HTMLButtonElement>('#pauseStream')!
    const stopStream = root.querySelector<HTMLButtonElement>('#stopStream')!
    const startDet = root.querySelector<HTMLButtonElement>('#startDetection')!
    const pauseOnce = root.querySelector<HTMLButtonElement>('#pauseSendOnce')!

    // Initially detection buttons are disabled
    expect(startDet.disabled).toBe(true)
    expect(pauseOnce.disabled).toBe(true)

    // Stub camera access
    const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(fakeStream)),
      },
    })
    // Stub video play
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    // Start stream
    await startStream.click()
    // Wait microtask queue to settle
    await Promise.resolve()

    // Detection buttons should now be enabled
    expect(startDet.disabled).toBe(false)
    expect(pauseOnce.disabled).toBe(false)

    // Pause stream
    await pauseStream.click()
    await Promise.resolve()
    // Buttons remain enabled on pause
    expect(startDet.disabled).toBe(false)
    expect(pauseOnce.disabled).toBe(false)

    // Stop stream
    await stopStream.click()
    await Promise.resolve()
    // Detection buttons disabled again
    expect(startDet.disabled).toBe(true)
    expect(pauseOnce.disabled).toBe(true)
  })

  it('resumes live stream after pause', async () => {
    const root = document.createElement('div')
    initCameraApp(root)
    const startStream = root.querySelector<HTMLButtonElement>('#startStream')!
    const pauseStream = root.querySelector<HTMLButtonElement>('#pauseStream')!

    const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(fakeStream)),
      },
    })
    const playSpy = vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(() => Promise.resolve())
    const pauseSpy = vi.spyOn(HTMLVideoElement.prototype, 'pause')

    // Start stream
    await startStream.click()
    await Promise.resolve()
    expect(playSpy).toHaveBeenCalledTimes(1)

    // Pause stream
    await pauseStream.click()
    await Promise.resolve()
    expect(pauseSpy).toHaveBeenCalled()

    // Resume by pressing Start again (enabled on paused state)
    await startStream.click()
    await Promise.resolve()
    // Should call play again to resume live stream
    expect(playSpy).toHaveBeenCalledTimes(2)
  })

  it('starts and stops detection loop correctly', async () => {
    vi.useFakeTimers()
    const root = document.createElement('div')
    initCameraApp(root)
    const startStream = root.querySelector<HTMLButtonElement>('#startStream')!
    const startDet = root.querySelector<HTMLButtonElement>('#startDetection')!
    const stopStream = root.querySelector<HTMLButtonElement>('#stopStream')!

    // Stub camera and fetch
    const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.resolve(fakeStream)),
      },
    })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ json: () => Promise.resolve({ count: 0, boxes: [] }) } as any)))
    vi.spyOn(HTMLVideoElement.prototype, 'play').mockImplementation(() => Promise.resolve())

    // Spy on setInterval and clearInterval
    const setIntervalSpy = vi.spyOn(global, 'setInterval')
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval')

    // Start stream
    await startStream.click()
    await Promise.resolve()
    // Start detection
    await startDet.click()
    expect(setIntervalSpy).toHaveBeenCalled()

    // Advance timers to simulate few detection cycles
    vi.advanceTimersByTime(3000)

    // Stop stream should clear timer
    await stopStream.click()
    expect(clearIntervalSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})