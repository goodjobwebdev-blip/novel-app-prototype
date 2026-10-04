import { useCallback, useEffect, useRef, useState } from 'react'
import { createImageWorkspaceState, type ImageWorkspaceState } from './ImageWorkspace'
import { loadBookImageSettings } from './book-image-settings'
import { loadMediaWorkspaceDraft, saveMediaWorkspaceDraft } from './media-draft-storage'

export function useMediaWorkspaceDraft() {
  const [state, setState] = useState(() => createImageWorkspaceState())
  const [error, setError] = useState('')
  const revision = useRef(0)
  useEffect(() => {
    let cancelled = false
    const captured = revision.current
    void loadMediaWorkspaceDraft().then(async saved => saved ?? createImageWorkspaceState(await loadBookImageSettings())).then(saved => { if (!cancelled && captured === revision.current) setState(saved) }).catch(() => { if (!cancelled) setError('Could not restore the saved media draft.') })
    return () => { cancelled = true }
  }, [])
  const update = useCallback((next: ImageWorkspaceState) => {
    const captured = ++revision.current
    setState(next)
    void saveMediaWorkspaceDraft(next).then(() => { if (captured === revision.current) setError('') }).catch(() => { if (captured === revision.current) setError('Could not save this media draft. Keep this page open and try editing again.') })
  }, [])
  return [state, update, error] as const
}
