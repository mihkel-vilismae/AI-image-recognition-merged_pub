import { describe, expect, it } from 'vitest'

import { checkHealth, validateAiServerHealth, validateHtmlServerUp } from '../src/tabs/health-check'

describe('health-check validators', () => {
  it('accepts ai server json payload with ok=true and service ai-server', () => {
    expect(validateAiServerHealth({ ok: true, service: 'ai-server' })).toBe(true)
    expect(validateAiServerHealth({ ok: true })).toBe(true)
    expect(validateAiServerHealth({ ok: false, service: 'ai-server' })).toBe(false)
    expect(validateAiServerHealth({ ok: true, service: 'vite' })).toBe(false)
  })

  it('accepts web ui html response markers and rejects json content-type', () => {
    const htmlResp = new Response('<!doctype html><html><body><div id="app"></div></body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
    expect(validateHtmlServerUp(htmlResp, '<div id="app"></div>')).toBe(true)

    const jsonResp = new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(validateHtmlServerUp(jsonResp, '{"ok":true}')).toBe(false)
  })

  it('fails ai health check when server returns html body', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response('<!doctype html><html><body><div id="app"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })

    const result = await checkHealth({ kind: 'aiServer', url: 'http://localhost:5173/health' }, fetchMock)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Expected JSON response')
    expect(result.contentType).toContain('text/html')
    expect(result.preview).toContain('<!doctype html>')
    expect(result.parseError).toBeTruthy()
  })

  it('passes web ui check with html content', async () => {
    const fetchMock: typeof fetch = async () =>
      new Response('<!doctype html><html><head></head><body><div id="app"></div><script type="module" src="/@vite/client"></script></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })

    const result = await checkHealth({ kind: 'webUi', url: 'http://localhost:5173/' }, fetchMock)
    expect(result.ok).toBe(true)
  })
})
