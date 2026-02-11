import { describe, expect, it, vi } from 'vitest'

import { buildDetectUrl, checkServerHealth, DEFAULT_AI_BASE_URL, normalizeAiBaseUrl } from '../src/tabs/camera-stream-utils'

describe('camera stream utils', () => {
  it('builds detect URL from default AI base URL', () => {
    expect(buildDetectUrl(DEFAULT_AI_BASE_URL, 0.25)).toBe('http://localhost:5175/api/detect?conf=0.25')
  })

  it('normalizes base URL to backend origin', () => {
    expect(normalizeAiBaseUrl('localhost:5175/api/detect?conf=0.3')).toBe('http://localhost:5175')
  })

  it('checks health using the exact configured AI base URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, service: 'ai-server' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const health = await checkServerHealth('http://localhost:8000')

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/health',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(health.ok).toBe(true)
    expect(health.healthUrl).toBe('http://localhost:8000/health')
  })
})
