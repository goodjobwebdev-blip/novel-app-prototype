import { markdownLanguage } from '@codemirror/lang-markdown'

export type DocumentBlock = { id: string; type: 'image' | 'comment' | 'beat'; assetId?: string; alt?: string; caption?: string; text?: string }
export type SourceRange = { from: number; to: number }
export type LocatedBlock = SourceRange & { block: DocumentBlock }
export function encodeDocumentBlock(block: DocumentBlock): string {
  return `<!--arc:block ${JSON.stringify(block).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')}-->`
}
export function documentBlocks(source: string): LocatedBlock[] {
  const blocks: LocatedBlock[] = []
  for (const match of source.matchAll(/<!--arc:block\s+([\s\S]*?)-->/g)) {
    try {
      const block = JSON.parse(match[1])
      if (typeof block.id !== 'string' || !['image', 'comment', 'beat'].includes(block.type)) continue
      if (['assetId', 'alt', 'caption', 'text'].some((key) => block[key] !== undefined && typeof block[key] !== 'string')) continue
      blocks.push({ from: match.index, to: match.index + match[0].length, block })
    } catch { /* Malformed blocks stay editable as source, and remain private in projections. */ }
  }
  return blocks
}
/** Shared exclusion policy for all prose consumers; malformed comments fail closed. */
export function protectedRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = []
  for (const match of source.matchAll(/<!--[\s\S]*?(?:-->|$)|<figure\b[\s\S]*?(?:<\/figure>|$)|<img\b[^>]*(?:>|$)/gi)) ranges.push({ from: match.index, to: match.index + match[0].length })
  const imageReferences = new Set<string>()
  markdownLanguage.parser.parse(source).iterate({ enter(node) {
    if (node.name === 'Image') {
      ranges.push({ from: node.from, to: node.to })
      const raw = source.slice(node.from, node.to)
      const reference = raw.match(/^!\[([^\]]*)\](?:\[([^\]]*)\])?$/)
      if (reference) imageReferences.add((reference[2] || reference[1]).trim().toLowerCase())
      return false
    }
  } })
  for (const match of source.matchAll(/^ {0,3}\[([^\]]+)\]:[^\n]*(?:\n[ \t]+[^\n]*)*/gm)) {
    if (imageReferences.has(match[1].trim().toLowerCase())) ranges.push({ from: match.index, to: match.index + match[0].length })
  }
  const merged: SourceRange[] = []
  for (const range of ranges.sort((a, b) => a.from - b.from || b.to - a.to)) {
    const previous = merged.at(-1)
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to)
    else merged.push({ ...range })
  }
  return merged
}
export function rangeTouchesProtected(source: string, from: number, to = from) {
  return protectedRanges(source).some((range) => from === to ? from > range.from && from < range.to : range.from < to && range.to > from)
}
export function projectProse(source: string) {
  const ranges = protectedRanges(source)
  let text = '', cursor = 0
  for (const range of ranges) { text += source.slice(cursor, range.from); cursor = range.to }
  text += source.slice(cursor)
  const sourceToProse = (position: number) => {
    const pos = Math.max(0, Math.min(source.length, position))
    return pos - ranges.reduce((removed, range) => removed + Math.max(0, Math.min(pos, range.to) - range.from), 0)
  }
  return { text, ranges, sourceToProse }
}
export const proseText = (source: string) => projectProse(source).text
export const PROSE_PROJECTION_VERSION = 1
/** Reject pre-projection summaries in books containing private material. */
export function proseEntities<T extends { type: string; content?: string; proseProjectionVersion?: unknown }>(entities: T[]): T[] {
  const hasPrivate = entities.some((entity) => entity.type !== 'summary' && protectedRanges(entity.content ?? '').length)
  return entities.map((entity) => ({ ...entity, ...(typeof entity.content === 'string' ? {
    content: entity.type === 'summary' && hasPrivate && entity.proseProjectionVersion !== PROSE_PROJECTION_VERSION ? '' : proseText(entity.content),
  } : {}) }))
}
export function remapDocumentBlocks(source: string, ids: Map<string, string>) {
  let result = source
  for (const item of documentBlocks(source).reverse()) {
    const block = { ...item.block, id: ids.get(item.block.id) ?? item.block.id }
    if (block.assetId) block.assetId = ids.get(block.assetId) ?? block.assetId
    result = result.slice(0, item.from) + encodeDocumentBlock(block) + result.slice(item.to)
  }
  result = result.replace(/<!--arc:passage\s+([\s\S]*?)-->/g, (raw, payload) => {
    try { const value = JSON.parse(payload); return `<!--arc:passage ${JSON.stringify({ ...value, beatId: ids.get(value.beatId) ?? value.beatId })}-->` } catch { return raw }
  })
  return result
}
