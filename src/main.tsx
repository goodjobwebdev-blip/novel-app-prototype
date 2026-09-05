import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Workspace from './Workspace'
import './editor-history-bridge'
import './styles.css'
import './button-interactions.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Workspace />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable online if offline caching is unavailable.
    })
  })
}
