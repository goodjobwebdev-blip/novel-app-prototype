import { passageMarkers } from './scene-beats'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import ExpandableTextInput from './ExpandableTextInput'
import type { MarkdownEditorHandle, EditorSelectionSnapshot } from './MarkdownEditor'
import { encodeDocumentBlock, rangeTouchesProtected, type DocumentBlock, type LocatedBlock } from './document-projection.ts'
import { listGalleryImages, imageId, notifyImageStore } from './image-store'
import { database } from './persistence'
import { prepareIllustration, checkStorageHeadroom } from './illustration-image'
import type { GalleryImage } from './image-generation-types'

export type BlockEditRequest = { documentId: string; item: LocatedBlock; snapshot: EditorSelectionSnapshot }
export default function EditorBlocks({ bookId, editor, disabled, editRequest, insertImage = false, onInsertHandled, onEditRequestHandled }: {
  onEditRequestHandled?: () => void; insertImage?: boolean; onInsertHandled?: () => void; bookId: string; editor: RefObject<MarkdownEditorHandle | null>; disabled: boolean; editRequest: BlockEditRequest | null
}) {
  const [draft, setDraft] = useState<{ block: DocumentBlock; snapshot: EditorSelectionSnapshot; existing: boolean } | null>(null)
  const [images, setImages] = useState<GalleryImage[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!draft) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('textarea, input, select, button')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [Boolean(draft)])
  useEffect(() => { if (editRequest) { setDraft({ block: { ...editRequest.item.block }, snapshot: editRequest.snapshot, existing: true }); setError(''); onEditRequestHandled?.() } }, [editRequest])
  useEffect(() => {
    if (draft?.block.type !== 'image') return
    let current = true
    void listGalleryImages(bookId).then((items) => { if (current) setImages(items.filter((item) => item.kind !== 'video')) }).catch(() => { if (current) setError('Could not load saved images.') })
    return () => { current = false }
  }, [draft?.block.type, bookId])
  const patch = (value: Partial<DocumentBlock>) => setDraft((current) => current ? { ...current, block: { ...current.block, ...value } } : current)
  const start = (type: DocumentBlock['type']) => {
    const snapshot = editor.current?.captureSelection()
    if (!snapshot || rangeTouchesProtected(snapshot.document, snapshot.from, snapshot.to)) { setError('Place the cursor in the manuscript outside an existing block.'); return }
    // Insert before the selection; adding a block never silently deletes selected prose.
    const at = { ...snapshot, to: snapshot.from, text: '' }
    setDraft({ block: { id: imageId('block'), type, text: '', alt: '', caption: '' }, snapshot: at, existing: false }); setError('')
  }
  useEffect(() => { if (insertImage && !disabled) { start('image'); onInsertHandled?.() } }, [insertImage, disabled])
  const apply = (remove = false) => {
    if (!draft) return
    if (remove && draft.block.type === 'beat') {
      let content = draft.snapshot.document
      const ranges = [{ from: draft.snapshot.from, to: draft.snapshot.to }, ...passageMarkers(content).filter((marker) => marker.beatId === draft.block.id)]
      for (const range of ranges.sort((a, b) => b.from - a.from)) content = content.slice(0, range.from) + content.slice(range.to)
      if (!editor.current?.replaceRange({ ...draft.snapshot, from: 0, to: draft.snapshot.document.length, text: draft.snapshot.document }, content, true)) { setError('The document changed. Reopen the beat.'); return }
      setDraft(null); return
    }
    const value = remove ? '' : encodeDocumentBlock(draft.block)
    const insert = draft.existing || remove ? value : `\n\n${value}\n\n`
    if (!editor.current?.replaceRange(draft.snapshot, insert, true)) { setError('The document changed. Close this panel and reopen the block to try again.'); return }
    setDraft(null)
  }
  return <>
    {error && !draft && <p role="alert">{error}</p>}
    {draft && createPortal(<div className="editor-block-backdrop"><section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="editor-block-title" className="editor-block-dialog" onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setDraft(null); if (event.key === 'Tab') { const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? []); const first = controls[0], last = controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() } } }}>
      <header><h2 id="editor-block-title">{draft.existing ? 'Edit' : 'Insert'} {draft.block.type === 'image' ? 'image' : draft.block.type === 'beat' ? 'scene beat' : 'private comment'}</h2><button type="button" disabled={busy} onClick={() => setDraft(null)} aria-label="Close block editor">×</button></header>
      <p>{draft.block.type === 'beat' ? 'Planning visible to Chat. Used as the instruction when generating this beat, and excluded from manuscript context and read aloud.' : 'This block stays in your book and backups. It is excluded from AI requests and read aloud.'}</p>
      {draft.block.type !== 'image' ? <ExpandableTextInput autoFocus value={draft.block.text || ''} onChange={(text) => patch({ text })} aria-label={draft.block.type === 'beat' ? 'Scene beat' : 'Private comment'} dialogTitle={draft.block.type === 'beat' ? 'Edit scene beat' : 'Edit private comment'} /> : <>
        <label>Saved image<select value={draft.block.assetId || ''} disabled={busy} onChange={async (event) => {
          const asset = images.find((image) => image.id === event.target.value)
          if (!asset) { patch({ assetId: '' }); return }
          if (!asset.id.startsWith('codex:')) { patch({ assetId: asset.id }); return }
          setBusy(true); setError('')
          try {
            const copy = { ...asset, id: imageId('editor-image'), bookId, prompt: 'Editor image', kept: true, createdAt: Date.now() }
            await (await database()).table('galleryImages').add(copy)
            setImages((items) => [copy, ...items]); patch({ assetId: copy.id }); notifyImageStore()
          } catch (e) { setError(e instanceof Error ? e.message : 'Could not save image.') } finally { setBusy(false) }
        }}><option value="">Choose an image</option>{images.map((image) => <option key={image.id} value={image.id}>{image.prompt || 'Saved image'} · {image.width} × {image.height}</option>)}</select></label>
        <label>Upload image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={async (event) => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
          setBusy(true); setError('')
          try {
            const pixels = await prepareIllustration(file); await checkStorageHeadroom(pixels.image.size + pixels.thumbnail.size)
            const asset: GalleryImage = { ...pixels, id: imageId('editor-image'), bookId, prompt: file.name, kept: true, kind: 'image', createdAt: Date.now() }
            await (await database()).table('galleryImages').add(asset)
            setImages((items) => [asset, ...items]); patch({ assetId: asset.id }); notifyImageStore()
          } catch (e) { setError(e instanceof Error ? e.message : 'Could not save image.') } finally { setBusy(false) }
        }} /></label>
        <label>Alternative text<input value={draft.block.alt || ''} onChange={(event) => patch({ alt: event.target.value })} /></label>
        <label>Caption<input value={draft.block.caption || ''} onChange={(event) => patch({ caption: event.target.value })} /></label>
      </>}
      {error && <p role="alert">{error}</p>}
      <footer>{draft.existing && <button type="button" disabled={busy || disabled} onClick={() => apply(true)}>Remove block</button>}<button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button><button type="button" disabled={busy || disabled || (draft.block.type === 'image' && !draft.block.assetId) || (draft.block.type === 'beat' && !draft.block.text?.trim())} onClick={() => apply()}>{busy ? 'Saving image…' : 'Apply'}</button></footer>
    </section></div>, document.body)}
  </>
}
