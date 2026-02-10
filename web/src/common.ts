export type AppRoute = 'images' | 'videos' | 'camera-stream' | 'webrtc-server'

const DEFAULT_ROUTE: AppRoute = 'images'

export function getRootOrThrow(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>('#app')
  if (!root) throw new Error('#app not found')
  return root
}

export function parseRouteFromHash(hash: string): AppRoute {
  const route = hash.replace(/^#\/?/, '')
  if (route === 'videos') return 'videos'
  if (route === 'camera-stream') return 'camera-stream'
  if (route === 'webrtc-server') return 'webrtc-server'
  return DEFAULT_ROUTE
}

export type AppEventName =
  | 'WEBRTC_SIGNALING_CONNECTING'
  | 'WEBRTC_SIGNALING_CONNECTED'
  | 'WEBRTC_SIGNALING_FAILED'
  | 'WEBRTC_VIEWER_READY_SENT'
  | 'WEBRTC_OFFER_RECEIVED'
  | 'WEBRTC_REMOTE_TRACK_RECEIVED'
  | 'WEBRTC_NEGOTIATION_FAILED'
  | 'SIGNALING_CONNECTING'
  | 'SIGNALING_CONNECTED'
  | 'SIGNALING_FAILED'
  | 'VIEWER_READY_SENT'
  | 'OFFER_RECEIVED'
  | 'REMOTE_TRACK_ATTACHED'
  | 'REMOTE_TRACK_FAILED'

const appEventBus = new EventTarget()

export function emitAppEvent(name: AppEventName, detail: Record<string, unknown> = {}) {
  appEventBus.dispatchEvent(new CustomEvent(name, { detail }))
}

export function onAppEvent(name: AppEventName, handler: (detail: Record<string, unknown>) => void): () => void {
  const listener = (event: Event) => {
    const custom = event as CustomEvent<Record<string, unknown>>
    handler(custom.detail ?? {})
  }
  appEventBus.addEventListener(name, listener)
  return () => appEventBus.removeEventListener(name, listener)
}
