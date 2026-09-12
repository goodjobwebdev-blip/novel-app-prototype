import { StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { documentBlocks, type LocatedBlock } from './document-projection.ts'
import { getGalleryImage } from './image-store'

class BlockWidget extends WidgetType {
  constructor(readonly item: LocatedBlock, readonly bookId: string, readonly edit: (item: LocatedBlock) => void, readonly readOnly: boolean) { super() }
  eq(other: BlockWidget) { return JSON.stringify(this.item) === JSON.stringify(other.item) && this.bookId === other.bookId && this.readOnly === other.readOnly }
  toDOM() {
    const container = document.createElement('div')
    container.className = `editor-block editor-block-${this.item.block.type}`
    const block = this.item.block
    const label = document.createElement('small')
    label.textContent = block.type === 'comment' ? 'Private comment · excluded from AI and read aloud' : 'Image · excluded from AI and read aloud'
    container.append(label)
    if (block.type === 'comment') {
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
    }
    return container
  }
  destroy(dom: HTMLElement) { if (dom.dataset.objectUrl) URL.revokeObjectURL(dom.dataset.objectUrl) }
  ignoreEvent() { return true }
}
export function editorBlockPreview(bookId: string, edit: (item: LocatedBlock) => void, readOnly: boolean) {
  const build = (source: string) => Decoration.set(documentBlocks(source).map((item) => Decoration.replace({ block: true, widget: new BlockWidget(item, bookId, edit, readOnly) }).range(item.from, item.to)), true)
  return StateField.define({
    create: (state) => build(state.doc.toString()),
    update: (value, transaction) => transaction.docChanged ? build(transaction.state.doc.toString()) : value,
    provide: (field) => [EditorView.decorations.from(field), EditorView.atomicRanges.of((view) => view.state.field(field))],
  })
}
