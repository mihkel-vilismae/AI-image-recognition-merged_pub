export type HealthTargets = {
  aiHealthUrl: string
  webUiUrl: string
  relayHealthUrl: string
  pcHealthUrl: string
  pcKind: 'pc' | 'webUi'
}

export type HealthTargetsInput = {
  aiBaseUrl?: string
  webUiBaseUrl?: string
  relayHost?: string
  relayPort?: number
  pcBaseUrl?: string
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '')
}

export function buildHealthTargets(input: HealthTargetsInput): HealthTargets {
  const aiBase = trimTrailingSlash((input.aiBaseUrl || 'http://localhost:8000').trim())
  const webUiBase = trimTrailingSlash((input.webUiBaseUrl || '').trim())

  const relayHost = (input.relayHost || '').trim()
  const relayPort = Number(input.relayPort || 8765)
  const relayHealthUrl = relayHost ? `http://${relayHost}:${relayPort + 1}/health` : 'runtime-only'

  const aiHealthUrl = aiBase ? `${aiBase}/health` : 'runtime-only'
  const webUiUrl = webUiBase ? `${webUiBase}/` : 'runtime-only'

  const pcBase = trimTrailingSlash((input.pcBaseUrl || '').trim())
  const hasDistinctPcBase = Boolean(pcBase && webUiBase && pcBase !== webUiBase)
  const pcHealthUrl = hasDistinctPcBase ? `${pcBase}/health` : 'runtime-only'

  return {
    aiHealthUrl,
    webUiUrl,
    relayHealthUrl,
    pcHealthUrl,
    pcKind: hasDistinctPcBase ? 'pc' : 'webUi',
  }
}
