import { beforeEach, describe, expect, it, vi } from 'vitest'

import { initVideoApp } from '../src/video'

const sampleResponse = {
  frame_count: 2,
  sampled_count: 2,
  samples: [
    {
      frame_index: 0,
      time_sec: 0,
      count: 1,
      boxes: [{ name: 'person', score: 0.9, xyxy: [10, 20, 100, 200] }],
      detection_request_at: '2026-01-01T00:00:00.000Z',
      detection_completed_at: '2026-01-01T00:00:00.050Z',
      detection_duration: 50,
    },
    {
      frame_index: 15,
      time_sec: 0.5,
      count: 0,
      boxes: [],
      detection_request_at: '2026-01-01T00:00:00.100Z',
      detection_completed_at: '2026-01-01T00:00:00.120Z',
      detection_duration: 20,
    },
  ],
}

describe('initVideoApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test-video'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('switches to realtime mode and shows stale-threshold slider', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    initVideoApp(root, { apiBase: 'http://localhost:8000' })
    root.querySelector<HTMLButtonElement>('#modeRealtime')!.click()

    expect(root.querySelector('.modeHeading')?.textContent).toContain('detect frames in real time')
    expect(root.querySelector<HTMLLabelElement>('#staleMsField')?.classList.contains('hidden')).toBe(false)
  })

  it('enables realtime start button after selecting a file', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile } = initVideoApp(root, { apiBase: 'http://localhost:8000' })
    const realtimeBtn = root.querySelector<HTMLButtonElement>('#startRealtime')!
    expect(realtimeBtn.disabled).toBe(true)

    onPickFile(new File([new Uint8Array([1, 2, 3])], 'sample.mp4', { type: 'video/mp4' }))
    expect(realtimeBtn.disabled).toBe(false)
  })

  it('truncates printed json for large detect-video sample list', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile, runDetectVideo } = initVideoApp(root, { apiBase: 'http://localhost:8000' })
    const video = root.querySelector<HTMLVideoElement>('#preview')!

    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 })
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 360 })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(video, 'pause', { configurable: true, value: vi.fn() })

    const manySamples = Array.from({ length: 150 }, (_, i) => ({
      frame_index: i,
      time_sec: i / 30,
      count: 0,
      boxes: [],
      detection_request_at: '2026-01-01T00:00:00.000Z',
      detection_completed_at: '2026-01-01T00:00:00.001Z',
      detection_duration: 1,
    }))

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ frame_count: 150, sampled_count: 150, samples: manySamples }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    onPickFile(new File([new Uint8Array([1, 2, 3])], 'picked.mp4', { type: 'video/mp4' }))
    await runDetectVideo()

    const rawText = root.querySelector<HTMLPreElement>('#raw')!.textContent || ''
    expect(rawText).toContain('"truncated": true')
    expect(rawText).toContain('first 100')
  })

  it('play-with-overlay button arms after detect and playback advances active row', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile, runDetectVideo } = initVideoApp(root, { apiBase: 'http://localhost:8000' })
    const video = root.querySelector<HTMLVideoElement>('#preview')!
    const playOverlayBtn = root.querySelector<HTMLButtonElement>('#playOverlay')!

    Object.defineProperty(video, 'readyState', { configurable: true, get: () => 1 })
    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 360 })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(video, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) })
    Object.defineProperty(video, 'pause', { configurable: true, value: vi.fn() })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(sampleResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    onPickFile(new File([new Uint8Array([1, 2, 3])], 'picked.mp4', { type: 'video/mp4' }))
    await runDetectVideo()

    expect(playOverlayBtn.disabled).toBe(false)
    expect(playOverlayBtn.classList.contains('armed')).toBe(true)
    playOverlayBtn.click()

    video.currentTime = 0.5
    video.dispatchEvent(new Event('timeupdate'))
    expect(root.querySelector('.row.selectable.active')?.getAttribute('data-index')).toBe('1')
  })



  it('appends realtime detections to the results list', async () => {
    vi.useFakeTimers()

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
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
    })

    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile, startRealtimeDetect } = initVideoApp(root, { apiBase: 'http://localhost:8000' })
    const video = root.querySelector<HTMLVideoElement>('#preview')!

    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 360 })
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0.25 })
    Object.defineProperty(video, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            count: 1,
            boxes: [{ name: 'person', score: 0.8, xyxy: [0, 0, 10, 10] }],
            detection_request_at: '2026-01-01T00:00:00.000Z',
            detection_completed_at: '2026-01-01T00:00:00.010Z',
            detection_duration: 10,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      ),
    )

    onPickFile(new File([new Uint8Array([1, 2, 3])], 'picked.mp4', { type: 'video/mp4' }))
    root.querySelector<HTMLButtonElement>('#modeRealtime')!.click()
    startRealtimeDetect()

    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    video.currentTime = 0.5
    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()

    const rows = root.querySelectorAll('#list .row')
    expect(rows.length).toBe(2)
    expect(root.querySelector('#list')?.textContent).toContain('0.00s')
    expect(root.querySelector('#list')?.textContent).toContain('0.50s')
  })

  it('discards stale realtime frame detections based on slider threshold', async () => {
    vi.useFakeTimers()

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
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
      cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }))
    })

    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile, startRealtimeDetect } = initVideoApp(root, { apiBase: 'http://localhost:8000' })
    const video = root.querySelector<HTMLVideoElement>('#preview')!

    Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 })
    Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 360 })
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false })
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(video, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) })

    let resolveFetch: ((value: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    onPickFile(new File([new Uint8Array([1, 2, 3])], 'picked.mp4', { type: 'video/mp4' }))
    root.querySelector<HTMLInputElement>('#staleMs')!.value = '100'
    root.querySelector<HTMLButtonElement>('#modeRealtime')!.click()
    startRealtimeDetect()

    await vi.advanceTimersByTimeAsync(300)
    await Promise.resolve()
    expect(resolveFetch).not.toBeNull()

    video.currentTime = 1.0
    resolveFetch?.(
      new Response(
        JSON.stringify({
          count: 1,
          boxes: [{ name: 'person', score: 0.8, xyxy: [0, 0, 10, 10] }],
          detection_request_at: '2026-01-01T00:00:00.000Z',
          detection_completed_at: '2026-01-01T00:00:01.000Z',
          detection_duration: 1000,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )

    await Promise.resolve()
    expect(root.querySelector('#list')?.textContent).toContain('Realtime detection running')
  })
})