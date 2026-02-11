import { describe, expect, it } from 'vitest'

import { buildDetectUrl, DEFAULT_AI_BASE_URL, normalizeAiBaseUrl } from '../src/tabs/camera-stream-utils'

describe('camera stream utils', () => {
  it('builds detect URL from default AI base URL', () => {
    expect(buildDetectUrl(DEFAULT_AI_BASE_URL, 0.25)).toBe('http://localhost:5175/api/detect?conf=0.25')
  })

  it('normalizes base URL to backend origin', () => {
    expect(normalizeAiBaseUrl('localhost:5175/api/detect?conf=0.3')).toBe('http://localhost:5175')
  })
})
