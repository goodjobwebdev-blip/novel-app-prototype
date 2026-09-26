import { useEffect, useState, type DependencyList } from 'react'
import { liveQuery } from 'dexie'
import { IMAGE_STORE_CHANGED } from './image-store'
import { IMAGE_SETTINGS_CHANGED, loadImageSettings } from './image-settings'
export function useImageQuery<T>(query: () => Promise<T>, deps: DependencyList, initial: T) {
  const [data, setData] = useState(initial)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(initial)
    const observe = () => liveQuery(query).subscribe({ next: (value) => { setData(value); setError('') }, error: (e) => setError(e instanceof Error ? e.message : 'Images could not be loaded.') })
    let subscription = observe()
    // Explicit local notifications also recover a subscription after a read error.
    const refresh = () => { subscription.unsubscribe(); subscription = observe() }
    window.addEventListener(IMAGE_STORE_CHANGED, refresh)
    window.addEventListener('arc-illustrations-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => { subscription.unsubscribe(); window.removeEventListener(IMAGE_STORE_CHANGED, refresh); window.removeEventListener('arc-illustrations-changed', refresh); window.removeEventListener('focus', refresh) }
  }, deps)
  return { data, error }
}
export function useImageSettings() {
  const [settings, setSettings] = useState(loadImageSettings)
  useEffect(() => { const reload = () => setSettings(loadImageSettings()); window.addEventListener(IMAGE_SETTINGS_CHANGED, reload); window.addEventListener('storage', reload); return () => { window.removeEventListener(IMAGE_SETTINGS_CHANGED, reload); window.removeEventListener('storage', reload) } }, [])
  return settings
}
export function useImageUrl(blob?: Blob) {
  const [item, setItem] = useState<{ blob: Blob; url: string }>()
  useEffect(() => { if (!blob) { setItem(undefined); return }; const url = URL.createObjectURL(blob); setItem({ blob, url }); return () => URL.revokeObjectURL(url) }, [blob])
  return item?.blob === blob ? item?.url : undefined
}
