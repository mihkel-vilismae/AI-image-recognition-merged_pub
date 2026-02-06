import './style.css'

import { parseRouteFromHash, type AppRoute } from './common'
import { mountCameraStreamTab } from './tabs/camera-stream-tab'
import { mountImagesTab } from './tabs/images-tab'
import { mountVideosTab } from './tabs/videos-tab'

function renderShell(root: HTMLElement) {
  root.innerHTML = `
  <div class="tabsShell">
    <nav class="tabsNav" aria-label="Main tabs">
      <a class="tabLink" data-route="images" href="#/images">Images</a>
      <a class="tabLink" data-route="videos" href="#/videos">Videos</a>
      <a class="tabLink" data-route="camera-stream" href="#/camera-stream">Camera Stream</a>
    </nav>
    <section id="tabView"></section>
  </div>
  `
}

function setActiveTab(root: HTMLElement, route: AppRoute) {
  for (const tab of root.querySelectorAll<HTMLAnchorElement>('.tabLink')) {
    tab.dataset.active = String(tab.dataset.route === route)
  }
}

function mountRoute(root: HTMLElement) {
  const route = parseRouteFromHash(window.location.hash)
  setActiveTab(root, route)

  const tabView = root.querySelector<HTMLElement>('#tabView')
  if (!tabView) throw new Error('#tabView not found')

  if (route === 'images') {
    mountImagesTab(tabView)
    return
  }

  if (route === 'videos') {
    mountVideosTab(tabView)
    return
  }

  mountCameraStreamTab(tabView)
}

export function initSinglePageApp(root: HTMLElement) {
  renderShell(root)

  if (!window.location.hash) {
    window.location.hash = '#/images'
  }

  mountRoute(root)
  window.addEventListener('hashchange', () => mountRoute(root))
}

const root = document.querySelector<HTMLDivElement>('#app')
if (root) {
  initSinglePageApp(root)
}