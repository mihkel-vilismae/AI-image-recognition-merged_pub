export const DEFAULT_PC_IP = '192.168.17.92'
export const DEFAULT_SERVER_PORT = 8000
export const DEFAULT_SIGNALING_PORT = 8765

export function buildOwnDetectUrlFromHost(host: string, conf = 0.25): string {
  const safeHost = typeof host === 'string' ? host.trim() : ''
  if (!safeHost) return ''
  return `http://${safeHost}:${DEFAULT_SERVER_PORT}/detect?conf=${conf}`
}

export function extractIpv4HostFromText(input: string): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  try {
    const parsed = new URL(trimmed)
    const m = parsed.hostname.match(/^(\d{1,3}(?:\.\d{1,3}){3})$/)
    return m ? m[1] : null
  } catch {}

  const m = trimmed.match(/(\d{1,3}(?:\.\d{1,3}){3})/)
  return m ? m[1] : null
}

export function buildSubnetIpv4Candidates(host: string): string[] {
  const h = extractIpv4HostFromText(host)
  if (!h) return []
  const parts = h.split('.')
  if (parts.length !== 4) return []

  const [a, b, c, d] = parts.map(Number)
  if ([a, b, c, d].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return []

  const candidates: string[] = []
  for (let i = 1; i <= 254; i++) candidates.push(`${a}.${b}.${c}.${i}`)

  const preferred = `${a}.${b}.${c}.${d}`
  if (d >= 1 && d <= 254) {
    const idx = candidates.indexOf(preferred)
    if (idx >= 0) {
      candidates.splice(idx, 1)
      candidates.unshift(preferred)
    }
  }

  return candidates
}

export function isLikelyCorsFetchError(err: unknown): boolean {
  if (!err) return false
  const msg = String((err as { message?: string }).message ?? err).toLowerCase()
  return msg.includes('cors') || msg.includes('failed to fetch') || msg.includes('networkerror')
}

export function hasVideoStreamSignal(message: unknown): boolean {
  if (typeof message === 'string') {
    const m = message.toLowerCase()
    return m.includes('m=video') || (m.includes('offer') && m.includes('video')) || m.includes('video stream')
  }

  if (!message || typeof message !== 'object') return false
  const record = message as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const kind = typeof record.kind === 'string' ? record.kind.toLowerCase() : ''
  const sdp = typeof record.sdp === 'string' ? record.sdp.toLowerCase() : ''

  if (kind === 'video') return true
  if (type === 'offer' && sdp.includes('m=video')) return true
  if (type.includes('video')) return true
  return false
}

export async function checkServerHealth(host: string, timeoutMs = 2500): Promise<{ ok: boolean; verified: boolean; reason: string }> {
  const corsController = new AbortController()
  const corsTimer = window.setTimeout(() => corsController.abort(), timeoutMs)

  try {
    const res = await fetch(`http://${host}:${DEFAULT_SERVER_PORT}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: corsController.signal,
    })
    if (!res.ok) return { ok: false, verified: false, reason: `http_${res.status}` }
    const payload = await res.json().catch(() => null)
    if (payload && payload.ok === true) return { ok: true, verified: true, reason: 'health_ok' }
    return { ok: false, verified: false, reason: 'bad_payload' }
  } catch (err) {
    if (!isLikelyCorsFetchError(err)) return { ok: false, verified: false, reason: 'network_error' }

    const noCorsController = new AbortController()
    const noCorsTimer = window.setTimeout(() => noCorsController.abort(), timeoutMs)
    try {
      await fetch(`http://${host}:${DEFAULT_SERVER_PORT}/health`, {
        method: 'GET',
        mode: 'no-cors',
        cache: 'no-store',
        signal: noCorsController.signal,
      })
      return { ok: true, verified: false, reason: 'cors_opaque_reachable' }
    } catch {
      return { ok: false, verified: false, reason: 'cors_blocked_or_unreachable' }
    } finally {
      window.clearTimeout(noCorsTimer)
    }
  } finally {
    window.clearTimeout(corsTimer)
  }
}

export async function scanSubnetForServer(seedHost: string): Promise<{ host: string; health: { ok: boolean; verified: boolean; reason: string } } | null> {
  const candidates = buildSubnetIpv4Candidates(seedHost)
  if (candidates.length === 0) return null

  const seedResult = await checkServerHealth(candidates[0], 2500)
  if (seedResult.ok) return { host: candidates[0], health: seedResult }

  const chunkSize = 12
  for (let i = 1; i < candidates.length; i += chunkSize) {
    const chunk = candidates.slice(i, i + chunkSize)
    const checks = chunk.map(async (host) => ({ host, health: await checkServerHealth(host, 1200) }))
    const results = await Promise.all(checks)
    const found = results.find((r) => r.health.ok)
    if (found) return found
  }

  return null
}
