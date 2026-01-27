import { initApp } from './app'

const root = document.querySelector<HTMLDivElement>('#app')
if (!root) throw new Error('#app not found')

initApp(root)
