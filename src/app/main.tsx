import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/literata'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/lora'
import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/crimson-pro'
import '@fontsource-variable/eb-garamond'
import '@fontsource-variable/noto-serif'
import '@fontsource-variable/roboto'
import '@fontsource-variable/open-sans'
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/manrope'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/roboto-mono'
import '@fontsource-variable/source-code-pro'
import Workspace from './Workspace'
import UiSettingsPortalBridge from '../features/settings/UiSettingsPortal'
import '../features/settings/violet-themes'
import { applyStoredUiSettings } from '../features/settings/ui-settings'
import '../features/editor/editor-history-bridge'
import './styles.css'
import '../shared/ui/button-interactions.css'
import '../features/chat/chat-composer-fix.css'
import '../features/chat/chat-model-picker-shape.css'
import '../features/settings/settings-scope.css'
import '../features/settings/ui-settings.css'
import '../shared/ui/mobile-control-hardening.css'
import '../features/settings/ai-settings-ux.css'
import '../shared/ui/generation-actions.css'
import '../features/settings/theme-accents.css'
import '../features/chat/composer.css'

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
