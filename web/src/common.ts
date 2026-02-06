export type AppRoute = 'images' | 'videos' | 'camera-stream'

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
  return DEFAULT_ROUTE
}