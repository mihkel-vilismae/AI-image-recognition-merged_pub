import './style.css'

import { APP_VERSION, parseRouteFromHash, type AppRoute } from './common'
import { mountCameraStreamTab } from './tabs/camera-stream-tab'
import { mountImagesTab } from './tabs/images-tab'
import { mountVideosTab } from './tabs/videos-tab'
import { mountWebrtcServerTab } from './tabs/webrtc-server-tab'
import { mountVidconMonitorTab } from './tabs/vidcon-monitor-tab'
import { mountMobileImageRecognitionTab } from './tabs/mobile-image-recognition/mobile-image-recognition-tab'

function renderShell(root: HTMLElement) {
  root.innerHTML = `
  <div class="tabsShell">
    <section class="mainMenu" aria-label="Main menu">
      <h2 class="mainMenuTitle">Main Menu</h2>
      <nav class="tabsNav" aria-label="Main tabs">
        <a class="tabLink" data-route="images" href="#/images">Images</a>
        <a class="tabLink" data-route="videos" href="#/videos">Videos</a>
        <a class="tabLink" data-route="camera-stream" href="#/camera-stream">Camera Stream</a>
        <a class="tabLink" data-route="webrtc-server" href="#/webrtc-server">WebRTC Server</a>
        <a class="tabLink" data-route="vidcon-monitor" href="#/vidcon-monitor">VidConMonitor</a>
        <a class="tabLink" data-route="mobile-image-recognition" href="#/mobile-image-recognition">Mobile Image Recognition</a>
      </nav>
    </section>
    <section id="tabView"></section>
    <footer class="mono" style="padding: 8px 2px; opacity: 0.8;">App Version: ${APP_VERSION}</footer>
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

  if (route === 'camera-stream') {
    mountCameraStreamTab(tabView)
    return
  }

  if (route === 'webrtc-server') {
    mountWebrtcServerTab(tabView)
    return
  }

  if (route === 'vidcon-monitor') {
    mountVidconMonitorTab(tabView)
    return
  }

  mountMobileImageRecognitionTab(tabView)
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
