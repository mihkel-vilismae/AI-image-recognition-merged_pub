import { initVideoApp } from './video'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('#app not found')

initVideoApp(root)
