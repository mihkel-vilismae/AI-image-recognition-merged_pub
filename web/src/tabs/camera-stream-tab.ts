import './tab-style.css'

export function mountCameraStreamTab(root: HTMLElement) {
  root.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="title">
        <h1>Camera Stream</h1>
      </div>
    </header>
    <main class="grid">
      <section class="card span2">hello camera stream</section>
    </main>
  </div>
  `
}
