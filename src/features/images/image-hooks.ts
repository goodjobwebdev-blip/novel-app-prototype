import { useEffect, useState, type DependencyList } from 'react'
import { liveQuery } from 'dexie'
import { IMAGE_STORE_CHANGED } from './image-store'
import { IMAGE_SETTINGS_CHANGED } from './image-settings'
import { SETTINGS_PROFILES_EVENT } from '../settings/settings-profiles'
import { emptyImageSettings, loadBookImageSettings } from './book-image-settings'
import type { ImageSettings } from './image-generation-types'
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
export function useImageSettings(bookId?: string) {
  const [result, setResult] = useState<{ bookId?: string; settings?: ImageSettings; error: string }>({ bookId, error: '' })
  useEffect(() => {
    let disposed = false, revision = 0
    const reload = () => {
      const captured = ++revision
      void loadBookImageSettings(bookId).then(settings => {
        if (!disposed && captured === revision) setResult({ bookId, settings, error: '' })
      }).catch(reason => {
        if (!disposed && captured === revision) setResult({ bookId, error: reason instanceof Error ? reason.message : 'Media profiles could not be loaded. Open global Settings to set them up.' })
      })
    }
    reload()
    const events = [SETTINGS_PROFILES_EVENT, IMAGE_SETTINGS_CHANGED, 'storage', 'focus']
    events.forEach(event => window.addEventListener(event, reload))
    return () => { disposed = true; events.forEach(event => window.removeEventListener(event, reload)) }
  }, [bookId])
  const current = result.bookId === bookId ? result : undefined
  return { ...(current?.settings ?? emptyImageSettings()), loading: !current?.settings && !current?.error, error: current?.error ?? '' }
}
export function useImageUrl(blob?: Blob) {
  const [item, setItem] = useState<{ blob: Blob; url: string }>()
  useEffect(() => { if (!blob) { setItem(undefined); return }; const url = URL.createObjectURL(blob); setItem({ blob, url }); return () => URL.revokeObjectURL(url) }, [blob])
  return item?.blob === blob ? item?.url : undefined
}
