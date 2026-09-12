import { passageMarkers } from './scene-beats'
import { StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { documentBlocks, type LocatedBlock } from './document-projection.ts'
import { getGalleryImage } from './image-store'

class BlockWidget extends WidgetType {
  constructor(readonly item: LocatedBlock, readonly bookId: string, readonly edit: (item: LocatedBlock) => void, readonly readOnly: boolean, readonly beatAction: (item: LocatedBlock, action: 'generate' | 'rebind') => void) { super() }
  eq(other: BlockWidget) { return JSON.stringify(this.item) === JSON.stringify(other.item) && this.bookId === other.bookId && this.readOnly === other.readOnly }
  toDOM() {
    const container = document.createElement('div')
    container.className = `editor-block editor-block-${this.item.block.type}`
    const block = this.item.block
    const label = document.createElement('small')
    label.textContent = block.type === 'beat' ? 'Scene beat · planning visible to Chat' : block.type === 'comment' ? 'Private comment · excluded from AI and read aloud' : 'Image · excluded from AI and read aloud'
    container.append(label)
    if (block.type !== 'image') {
      const text = document.createElement('p'); text.textContent = block.text || 'Empty comment'; container.append(text)
    } else {
      const image = document.createElement('img'); image.alt = block.alt || ''; container.append(image)
      const status = document.createElement('p'); status.textContent = 'Loading image…'; container.append(status)
      void getGalleryImage(block.assetId || '').then((asset) => {
        if (!container.isConnected) return
        if (!asset || asset.bookId !== this.bookId || asset.kind === 'video') { status.textContent = 'Image unavailable. Choose a replacement.'; image.remove(); return }
        const url = URL.createObjectURL(asset.image); image.src = url; container.dataset.objectUrl = url; status.remove()
      }).catch(() => { status.textContent = 'Image could not be loaded.' })
      if (block.caption) { const caption = document.createElement('p'); caption.textContent = block.caption; container.append(caption) }
    }
    if (!this.readOnly) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `Edit ${block.type}`
      button.onclick = () => this.edit(this.item); container.append(button)
      if (block.type === 'beat') for (const action of ['generate', 'rebind'] as const) {
        const control = document.createElement('button'); control.type = 'button'; control.textContent = action === 'generate' ? 'Generate / regenerate' : 'Bind selected prose'; control.onclick = () => this.beatAction(this.item, action); container.append(control)
      }
    }
    return container
  }
  destroy(dom: HTMLElement) { if (dom.dataset.objectUrl) URL.revokeObjectURL(dom.dataset.objectUrl) }
  ignoreEvent() { return true }
}
export function editorBlockPreview(bookId: string, edit: (item: LocatedBlock) => void, readOnly: boolean, showBeats = true, beatAction: (item: LocatedBlock, action: 'generate' | 'rebind') => void = () => {}) {
  const build = (source: string) => Decoration.set([
    ...documentBlocks(source).map((item) => (item.block.type === 'beat' && !showBeats ? Decoration.replace({}) : Decoration.replace({ block: true, widget: new BlockWidget(item, bookId, edit, readOnly, beatAction) })).range(item.from, item.to)),
    ...passageMarkers(source).map((marker) => Decoration.replace({}).range(marker.from, marker.to)),
  ], true)
  return StateField.define({
    create: (state) => build(state.doc.toString()),
    update: (value, transaction) => transaction.docChanged ? build(transaction.state.doc.toString()) : value,
    provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
  })
}
