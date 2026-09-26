type Description = { caption: string; alt: string }
const memory = new Map<string, Description>()
const keyFor = (entryId: string, imageId: string) => `arc-image-description:${entryId}:${imageId}`
export function readDescriptionDraft(entryId: string, imageId: string): Description | undefined {
  const key = keyFor(entryId, imageId)
  if (memory.has(key)) return memory.get(key)
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (value && typeof value.caption === 'string' && typeof value.alt === 'string') return { caption: value.caption.slice(0, 2000), alt: value.alt.slice(0, 2000) }
  } catch { /* Memory fallback also works when browser storage is unavailable. */ }
}
export function saveDescriptionDraft(entryId: string, imageId: string, value: Description) {
  const key = keyFor(entryId, imageId)
  memory.set(key, { ...value })
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Keep the in-memory draft. */ }
}
export function clearDescriptionDraft(entryId: string, imageId: string) {
  const key = keyFor(entryId, imageId)
  memory.delete(key)
  try { sessionStorage.removeItem(key) } catch { /* Nothing to clear. */ }
}
