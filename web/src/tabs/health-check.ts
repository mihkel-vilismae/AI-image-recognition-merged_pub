export type HealthKind = 'aiServer' | 'webUi' | 'relay' | 'pc'

export type HealthCheckInput = {
  kind: HealthKind
  url: string
  timeoutMs?: number
}

export type HealthCheckResult = {
  ok: boolean
  kind: HealthKind
  url: string
  status: number
  contentType: string
  error?: string
  parseError?: string
  preview?: string
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, {
      cache: 'no-store',
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timer)
  }
}

export function readContentType(resp: Response): string {
  return String(resp.headers.get('content-type') || '').toLowerCase()
}

export function parseJsonSafe(text: string): { value: unknown | null; error?: string } {
  try {
    return { value: JSON.parse(text) }
  } catch (error) {
    return { value: null, error: String(error) }
  }
}

export function validateAiServerHealth(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false
  const candidate = json as Record<string, unknown>
  if (candidate.ok !== true) return false
  if (candidate.service != null && candidate.service !== 'ai-server') return false
  return true
}

export function validateHtmlServerUp(resp: Response, text: string): boolean {
  const contentType = readContentType(resp)
  if (!resp.ok) return false
  if (!contentType.includes('text/html')) return false
  return text.includes('<div id="app">') || text.includes('@vite/client') || text.includes('<!doctype html>')
}

export async function checkHealth(
  input: HealthCheckInput,
  fetchImpl: typeof fetch = fetch,
): Promise<HealthCheckResult> {
  const timeoutMs = input.timeoutMs ?? 1800

  try {
    const response = await fetchWithTimeout(input.url, timeoutMs, fetchImpl)
    const status = response.status
    const contentType = readContentType(response)
    const text = await response.text()
    const preview = text.slice(0, 200)

    if (input.kind === 'webUi') {
      const ok = validateHtmlServerUp(response, text)
      return {
        ok,
        kind: input.kind,
        url: input.url,
        status,
        contentType,
        error: ok ? undefined : 'Expected Web UI HTML response',
        preview,
      }
    }

    const parsed = parseJsonSafe(text)
    if (parsed.error) {
      return {
        ok: false,
        kind: input.kind,
        url: input.url,
        status,
        contentType,
        error: 'Expected JSON response',
        parseError: parsed.error,
        preview,
      }
    }

    const ok = validateAiServerHealth(parsed.value)
    return {
      ok,
      kind: input.kind,
      url: input.url,
      status,
      contentType,
      error: ok ? undefined : 'Expected JSON payload with ok:true',
      preview,
    }
  } catch (error) {
    return {
      ok: false,
      kind: input.kind,
      url: input.url,
      status: 0,
      contentType: '',
      error: String(error),
    }
  }
}
