import { describe, expect, it } from 'vitest'

import { buildHealthTargets } from '../src/tabs/health-targets'

describe('buildHealthTargets', () => {
  it('uses expected default service URLs', () => {
    const targets = buildHealthTargets({
      aiBaseUrl: 'http://localhost:8000',
      webUiBaseUrl: 'http://localhost:5173',
      relayHost: 'localhost',
      relayPort: 8765,
      pcBaseUrl: '',
    })

    expect(targets.aiHealthUrl).toBe('http://localhost:8000/health')
    expect(targets.webUiUrl).toBe('http://localhost:5173/')
    expect(targets.relayHealthUrl).toBe('http://localhost:8766/health')
    expect(targets.pcHealthUrl).toBe('runtime-only')
    expect(targets.pcKind).toBe('webUi')
  })

  it('keeps pc health distinct only when configured separately from web ui', () => {
    const distinct = buildHealthTargets({
      webUiBaseUrl: 'http://localhost:5173',
      pcBaseUrl: 'http://192.168.0.10:5173',
    })
    expect(distinct.pcKind).toBe('pc')
    expect(distinct.pcHealthUrl).toBe('http://192.168.0.10:5173/health')

    const sameAsWeb = buildHealthTargets({
      webUiBaseUrl: 'http://localhost:5173',
      pcBaseUrl: 'http://localhost:5173',
    })
    expect(sameAsWeb.pcKind).toBe('webUi')
    expect(sameAsWeb.pcHealthUrl).toBe('runtime-only')
  })
})
