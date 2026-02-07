import './tab-style.css'
import { buildOwnDetectUrlFromHost, checkServerHealth, DEFAULT_PC_IP, extractIpv4HostFromText, scanSubnetForServer } from './camera-stream-utils'

export function mountCameraStreamTab(root: HTMLElement) {
  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title">
        <h1>Camera Stream</h1>
      </div>
    </header>
    <main class="grid">
      <section class="card span2">
        <p>hello camera stream</p>
        <div class="controls">
          <label class="field" for="ownUrl"><span>Own URL</span></label>
          <input id="ownUrl" class="mono" value="${buildOwnDetectUrlFromHost(DEFAULT_PC_IP)}" />
          <button id="btnCheckOwnHealth" class="btn" type="button">Check selected IP /health</button>
          <button id="btnScanOwnServer" class="btn" type="button">Scan local network for server</button>
          <div id="cameraStreamStatus" class="hint mono">Idle</div>
        </div>
      </section>
    </main>
  </div>
  `

  const ownUrlEl = root.querySelector<HTMLInputElement>('#ownUrl')!
  const statusEl = root.querySelector<HTMLDivElement>('#cameraStreamStatus')!
  const btnCheckEl = root.querySelector<HTMLButtonElement>('#btnCheckOwnHealth')!
  const btnScanEl = root.querySelector<HTMLButtonElement>('#btnScanOwnServer')!

  btnCheckEl.addEventListener('click', async () => {
    const host = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    statusEl.textContent = 'Checking /health…'
    const health = await checkServerHealth(host)

    if (health.ok) {
      ownUrlEl.value = buildOwnDetectUrlFromHost(host)
      statusEl.textContent = health.verified ? 'own server health check passed' : 'server reachable (CORS-limited health)'
      return
    }

    statusEl.textContent = 'own server health check failed'
  })

  btnScanEl.addEventListener('click', async () => {
    const seedHost = extractIpv4HostFromText(ownUrlEl.value) ?? DEFAULT_PC_IP
    statusEl.textContent = 'Scanning local network…'
    const found = await scanSubnetForServer(seedHost)

    if (!found) {
      statusEl.textContent = 'own server scan failed'
      return
    }

    ownUrlEl.value = buildOwnDetectUrlFromHost(found.host)
    statusEl.textContent = found.health.verified ? 'own server found' : 'server reachable (CORS-limited health)'
  })
}
