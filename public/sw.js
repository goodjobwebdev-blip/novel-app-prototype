const CACHE_NAME = 'novel-app-prototype-v1'
const APP_ROOT = '/novel-app-prototype/'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.add(APP_ROOT)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('novel-app-prototype-') && key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_ROOT)) return
  const navigation = event.request.mode === 'navigate'
  const asset = url.pathname.startsWith(`${APP_ROOT}assets/`)
  event.respondWith((async () => {
    let cache, cached
    try {
      cache = await caches.open(CACHE_NAME)
      cached = await cache.match(event.request)
    } catch { /* Cache storage may be unavailable while the network works. */ }
    const usable = cached?.ok && (!asset || !cached.headers.get('content-type')?.includes('text/html'))
    // Hashed assets are immutable. Retain the working copy across deployments
    // instead of replacing it with a 404 when an older tab asks for its bundle.
    if (asset && usable) return cached
    try {
      const response = await fetch(event.request)
      if (response.ok) {
        try { await cache?.put(event.request, response.clone()) } catch { /* A full cache must not block the app. */ }
        return response
      }
      if (usable) return cached
      return response
    } catch {
      if (usable) return cached
      // HTML is only a navigation fallback, never a JS, font, or CSS response.
      if (navigation) {
        const shell = await cache?.match(APP_ROOT).catch(() => undefined)
        if (shell?.ok) return shell
      }
      return Response.error()
    }
  })())
})
