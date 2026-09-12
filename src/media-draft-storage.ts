import { database } from './persistence'
import { KeyedAsyncQueue } from './keyed-async-queue'
import type { ImageWorkspaceState } from './ImageWorkspace'

const key = 'image-workspace-draft-v1'
const writes = new KeyedAsyncQueue()
export async function loadMediaWorkspaceDraft(): Promise<ImageWorkspaceState | undefined> {
  const value = (await (await database()).table('meta').get(key))?.value
  if (!value || !value.draft || typeof value.draft.prompt !== 'string' || typeof value.draft.alias !== 'string' || typeof value.draft.size !== 'string') return undefined
  return { ...value, tab: value.tab === 'gallery' ? 'gallery' : 'generate', gallery: { query: '', scope: 'all', limit: 40, ...value.gallery } }
}
export function saveMediaWorkspaceDraft(value: ImageWorkspaceState) {
  const snapshot = structuredClone(value)
  return writes.run(key, async () => { await (await database()).table('meta').put({ key, value: snapshot }) })
}
