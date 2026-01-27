import { describe, expect, it, vi } from 'vitest'
import { initApp } from '../src/app'

function makeClipboardEventWithImage(file: File) {
  const item = {
    kind: 'file',
    getAsFile: () => file,
  }

  const ev: any = new Event('paste')
  ev.clipboardData = { items: [item] }
  ev.preventDefault = vi.fn()
  return ev as ClipboardEvent
}

describe('initApp', () => {
  it('enables Detect button after selecting a file via onPickFile()', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    const { onPickFile } = initApp(root, { apiBase: 'http://localhost:8000' })

    const btn = root.querySelector<HTMLButtonElement>('#run')!
    expect(btn.disabled).toBe(true)

    const f = new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })
    onPickFile(f)

    // button should become enabled
    expect(btn.disabled).toBe(false)
  })

  it('handles Ctrl+V paste and calls preventDefault when an image is present', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)

    initApp(root, { apiBase: 'http://localhost:8000' })

    const f = new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' })
    const ev = makeClipboardEventWithImage(f)

    window.dispatchEvent(ev)

    expect((ev as any).preventDefault).toHaveBeenCalled()
  })
})
