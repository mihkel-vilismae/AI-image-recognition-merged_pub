import '../tab-style.css'

import type { DetectResponse } from '../../app'

export function mountMobileImageRecognitionTab(root: HTMLElement, apiBase = '/api') {
  root.innerHTML = `
    <div class="tabPage">
      <header class="tabHeader">
        <h1>Mobile Image Recognition</h1>
        <p>Upload an image, run mobile AI recognition, and view boxes drawn on the image.</p>
      </header>

      <section class="tabSection">
        <h2>1) Upload image</h2>
        <input id="mobileImageFile" type="file" accept="image/*" />
      </section>

      <section class="tabSection">
        <h2>2) Run mobile recognition</h2>
        <button id="mobileImageRun" type="button" disabled>Run Mobile AI Recognition</button>
      </section>

      <section class="tabSection">
        <h2>3) Result</h2>
        <canvas id="mobileImageCanvas"></canvas>
        <div id="mobileImageEmpty" class="mono">No image uploaded.</div>
      </section>

      <section class="tabSection">
        <h2>Detections</h2>
        <pre id="mobileImageRaw" class="mono">{}</pre>
      </section>
    </div>
  `

  const fileEl = root.querySelector<HTMLInputElement>('#mobileImageFile')
  const runEl = root.querySelector<HTMLButtonElement>('#mobileImageRun')
  const canvas = root.querySelector<HTMLCanvasElement>('#mobileImageCanvas')
  const emptyEl = root.querySelector<HTMLDivElement>('#mobileImageEmpty')
  const rawEl = root.querySelector<HTMLPreElement>('#mobileImageRaw')

  if (!fileEl || !runEl || !canvas || !emptyEl || !rawEl) {
    throw new Error('Mobile image recognition tab failed to initialize')
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  let selectedFile: File | null = null
  let selectedImage: HTMLImageElement | null = null

  function drawImage(img: HTMLImageElement) {
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
  }

  function drawBoxes(img: HTMLImageElement, boxes: DetectResponse['boxes']) {
    drawImage(img)
    const lineWidth = Math.max(2, Math.round(canvas.width / 320))
    const fontPx = Math.max(12, Math.round(canvas.width / 55))
    ctx.lineWidth = lineWidth
    ctx.font = `${fontPx}px system-ui`

    for (const box of boxes || []) {
      const [x1, y1, x2, y2] = box.xyxy
      const width = x2 - x1
      const height = y2 - y1
      const label = `${box.name} ${(box.score * 100).toFixed(1)}%`

      ctx.strokeStyle = '#29b6f6'
      ctx.strokeRect(x1, y1, width, height)

      const textWidth = ctx.measureText(label).width
      const labelHeight = fontPx + 8
      const labelY = Math.max(0, y1 - labelHeight)
      ctx.fillStyle = '#29b6f6'
      ctx.fillRect(x1, labelY, textWidth + 10, labelHeight)

      ctx.fillStyle = '#04111d'
      ctx.fillText(label, x1 + 5, labelY + labelHeight - 4)
    }
  }

  async function loadImage(file: File): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    await img.decode()
    URL.revokeObjectURL(url)
    return img
  }

  fileEl.addEventListener('change', async () => {
    const file = fileEl.files?.[0]
    if (!file) return

    selectedFile = file
    runEl.disabled = false
    rawEl.textContent = '{}'
    emptyEl.textContent = 'Loading preview…'

    try {
      selectedImage = await loadImage(file)
      drawImage(selectedImage)
      emptyEl.textContent = ''
    } catch {
      selectedImage = null
      runEl.disabled = true
      emptyEl.textContent = 'Could not load selected image.'
    }
  })

  runEl.addEventListener('click', async () => {
    if (!selectedFile || !selectedImage) return

    runEl.disabled = true
    emptyEl.textContent = 'Running mobile AI recognition…'

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch(`${apiBase}/detect`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const result = (await response.json()) as DetectResponse
      rawEl.textContent = JSON.stringify(result, null, 2)
      drawBoxes(selectedImage, result.boxes || [])
      emptyEl.textContent = `Done. ${result.count ?? 0} detections.`
    } catch (error) {
      rawEl.textContent = String(error)
      emptyEl.textContent = 'Mobile AI recognition failed.'
      drawImage(selectedImage)
    } finally {
      runEl.disabled = false
    }
  })
}
