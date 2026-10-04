import { getBookProfileSelections } from '../../data/persistence'
import { resolveProfileMediaSettings } from '../settings/settings-profiles'
import type { ImageSettings } from './image-generation-types'

/** Keep legacy loadImageSettings independent: the profile service uses it to seed the library. */
export async function loadBookImageSettings(bookId?: string): Promise<ImageSettings> {
  const selections = bookId ? await getBookProfileSelections(bookId) : undefined
  return resolveProfileMediaSettings(selections)
}

export function emptyImageSettings(): ImageSettings {
  return { keys: { nanogpt: '', openai: '', pruna: '' }, favorites: [], defaultAlias: '', defaultAliases: {} }
}
