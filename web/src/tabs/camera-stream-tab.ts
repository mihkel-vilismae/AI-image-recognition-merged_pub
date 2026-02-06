import './tab-style.css'
import { initCameraApp } from '../camera'

/**
 * Mounts the camera stream tab into the provided root element. This simply
 * delegates to `initCameraApp` defined in `../camera` which handles
 * constructing the UI and hooking up all event listeners. Keeping the
 * mounting function thin preserves architectural boundaries and makes
 * the tab system consistent across modules.
 */
export function mountCameraStreamTab(root: HTMLElement) {
  initCameraApp(root)
}
