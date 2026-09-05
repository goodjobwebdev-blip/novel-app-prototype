import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Workspace from './Workspace'
import './editor-history-bridge'
import './styles.css'
import './button-interactions.css'
import './chat-composer-fix.css'
import './chat-model-picker-shape.css'
import './settings-scope.css'

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
