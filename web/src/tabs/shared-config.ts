export const STORAGE_SIGNALING_URL_KEY = 'vidcon.signalingUrl'
export const STORAGE_AI_BASE_URL_KEY = 'cameraStream.aiBaseUrl'

export const DEFAULT_SIGNALING_URL = 'ws://localhost:8765'
export const DEFAULT_AI_BASE_URL = 'http://localhost:8000'

export function getSignalingUrlFromStorage(): string {
  const stored = localStorage.getItem(STORAGE_SIGNALING_URL_KEY)?.trim() || ''
  return stored || DEFAULT_SIGNALING_URL
}

export function getAiBaseUrlFromStorage(): string {
  const stored = localStorage.getItem(STORAGE_AI_BASE_URL_KEY)?.trim() || ''
  return stored || DEFAULT_AI_BASE_URL
}
