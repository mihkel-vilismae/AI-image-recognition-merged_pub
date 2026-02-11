import { DEFAULT_AI_BASE_URL, DEFAULT_SIGNALING_PORT } from './camera-stream-utils'

export const STORAGE_RELAY_KEY = 'webrtc.lastGoodRelay'
export const STORAGE_AI_BASE_URL_KEY = 'cameraStream.aiBaseUrl'

export function getSignalingUrlFromStorage(): string {
  const stored = localStorage.getItem(STORAGE_RELAY_KEY)?.trim() || ''
  return stored || `ws://localhost:${DEFAULT_SIGNALING_PORT}`
}

export function getAiBaseUrlFromStorage(): string {
  const stored = localStorage.getItem(STORAGE_AI_BASE_URL_KEY)?.trim() || ''
  return stored || DEFAULT_AI_BASE_URL
}
