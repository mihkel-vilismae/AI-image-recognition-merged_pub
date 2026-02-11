import './tab-style.css'
import { createVidconMonitorEngine, type MonitorBlock, type MonitorBlockId, type MonitorState } from './vidcon-monitor-engine'

const BLOCK_ORDER: MonitorBlockId[] = [
  'signalingRelayReachable',
  'phonePublisherPageLoaded',
  'phoneCameraActive',
  'webrtcOfferAnswerCompleted',
  'webrtcPeerConnectionConnected',
  'remoteVideoTrackReceived',
  'videoElementRendering',
  'aiServerHealthy',
]

function stateClass(state: MonitorState): string {
  if (state === 'OK') return 'vidconBlock--ok'
  if (state === 'CHECKING') return 'vidconBlock--checking'
  if (state === 'FAIL') return 'vidconBlock--fail'
  return 'vidconBlock--idle'
}

function fmt(ts: number | null): string {
  if (!ts) return 'n/a'
  const d = new Date(ts)
  return d.toLocaleTimeString()
}

export function mountVidconMonitorTab(root: HTMLElement) {
  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title"><h1>VidConMonitor</h1></div>
    </header>
    <main>
      <section class="card">
        <p>Visual status monitor for phone → signaling → WebRTC → PC video rendering.</p>
        <div class="vidconGrid" id="vidconGrid"></div>
        <video id="vidconHiddenVideo" autoplay muted playsinline class="vidconHiddenVideo"></video>
      </section>
    </main>
  </div>
  `

  const grid = root.querySelector<HTMLDivElement>('#vidconGrid')!
  const hiddenVideo = root.querySelector<HTMLVideoElement>('#vidconHiddenVideo')!

  const cardById = new Map<MonitorBlockId, HTMLElement>()

  for (const id of BLOCK_ORDER) {
    const block = document.createElement('article')
    block.className = 'vidconBlock vidconBlock--idle'
    block.dataset.block = id
    block.innerHTML = `
      <div class="vidconTitleRow">
        <h2 class="vidconTitle"></h2>
        <span class="vidconDepWarn" aria-label="dependency warning">⚠</span>
      </div>
      <div class="vidconState mono">NOT_STARTED</div>
      <div class="vidconDetail"></div>
      <div class="vidconMeta mono"></div>
      <div class="vidconDeps mono"></div>
    `
    grid.appendChild(block)
    cardById.set(id, block)
  }

  function render(snapshot: Record<MonitorBlockId, MonitorBlock>) {
    for (const id of BLOCK_ORDER) {
      const block = snapshot[id]
      const card = cardById.get(id)
      if (!card) continue

      card.className = `vidconBlock ${stateClass(block.state)}`
      card.querySelector('.vidconTitle')!.textContent = block.title
      card.querySelector('.vidconState')!.textContent = block.state
      card.querySelector('.vidconDetail')!.textContent = block.detail
      card.querySelector('.vidconMeta')!.textContent = `lastChecked ${fmt(block.lastCheckedAt)} · lastOk ${fmt(block.lastOkAt)}`
      card.querySelector('.vidconDeps')!.textContent = block.dependencies.length ? `Depends on: ${block.dependencies.join(' → ')}` : 'Depends on: none'

      const hasDependencyIssue = block.dependencies.some((dep) => snapshot[dep].state !== 'OK')
      card.querySelector('.vidconDepWarn')!.classList.toggle('hidden', !hasDependencyIssue)
    }
  }

  const engine = createVidconMonitorEngine({
    onUpdate: render,
    videoEl: hiddenVideo,
  })

  engine.start()

  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) {
      observer.disconnect()
      engine.stop()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
}
