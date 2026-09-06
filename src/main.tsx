import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/literata'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/lora'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/crimson-pro'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/manrope'
import '@fontsource-variable/noto-serif'
import '@fontsource-variable/open-sans'
import '@fontsource-variable/roboto'
import '@fontsource-variable/roboto-mono'
import '@fontsource-variable/source-code-pro'
import Workspace from './Workspace'
import UiSettingsPortalBridge from './UiSettingsPortal'
import './violet-themes'
import { applyStoredUiSettings } from './ui-settings'
import './editor-history-bridge'
import './styles.css'
import './button-interactions.css'
import './chat-composer-fix.css'
import './chat-model-picker-shape.css'
import './settings-scope.css'
import './ui-settings.css'
import './mobile-control-hardening.css'

applyStoredUiSettings()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <Workspace />
      <UiSettingsPortalBridge />
    </>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // The app remains usable online if offline caching is unavailable.
    })
  })
}
