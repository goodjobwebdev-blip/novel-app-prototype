import { documentBlocks, encodeDocumentBlock, protectedRanges, rangeTouchesProtected, type LocatedBlock } from './document-projection.ts'

export type BeatPassage = { beat: LocatedBlock; from: number; to: number; startFrom: number; endTo: number }
export const sceneBeats = (source: string) => documentBlocks(source).filter((item) => item.block.type === 'beat')
export const passageMarker = (id: string, edge: 'start' | 'end') => `<!--arc:passage ${JSON.stringify({ beatId: id, edge })}-->`
export function passageMarkers(source: string) {
  const result: Array<{ from: number; to: number; beatId: string; edge: 'start' | 'end' }> = []
  for (const match of source.matchAll(/<!--arc:passage\s+([\s\S]*?)-->/g)) {
    try { const value = JSON.parse(match[1]); if (typeof value.beatId === 'string' && ['start', 'end'].includes(value.edge)) result.push({ from: match.index, to: match.index + match[0].length, beatId: value.beatId, edge: value.edge }) } catch { /* Invalid anchors require rebinding. */ }
  }
  return result
}
export function beatPassage(source: string, beatId: string): BeatPassage | null {
  const beats = sceneBeats(source).filter((item) => item.block.id === beatId)
  const markers = passageMarkers(source).filter((marker) => marker.beatId === beatId)
  const start = markers.find((marker) => marker.edge === 'start'), end = markers.find((marker) => marker.edge === 'end')
  if (beats.length !== 1 || markers.length !== 2 || !start || !end || start.to > end.from || beats[0].to > start.from) return null
  // Never guess through another block, image or an overlapping passage anchor.
  if (protectedRanges(source.slice(start.to, end.from)).length) return null
  return { beat: beats[0], from: start.to, to: end.from, startFrom: start.from, endTo: end.to }
}
export function prepareAutomaticBeat(source: string, cursor: number, instruction: string, id: string) {
  if (!instruction.trim()) return null
  if (rangeTouchesProtected(source, cursor)) throw new Error('Place the cursor in prose outside existing blocks.')
  let position = cursor
  for (const item of sceneBeats(source)) {
    const passage = beatPassage(source, item.block.id)
    if (!passage || cursor < passage.from || cursor > passage.to) continue
    if (item.block.text?.trim() === instruction.trim()) return { source, position: cursor, beatId: item.block.id }
    if (source.slice(cursor, passage.to).trim()) throw new Error('Place the cursor after this beat’s passage before starting a new beat.')
    position = passage.endTo
  }
  const block = encodeDocumentBlock({ id, type: 'beat', text: instruction.trim() })
  const prefix = `\n\n${block}\n${passageMarker(id, 'start')}\n\n`
  const insert = `${prefix}\n\n${passageMarker(id, 'end')}\n\n`
  return { source: source.slice(0, position) + insert + source.slice(position), position: position + prefix.length, beatId: id }
}
export function bindBeatPassage(source: string, beatId: string, from: number, to: number) {
  const beat = sceneBeats(source).find((item) => item.block.id === beatId)
  if (!beat || from < beat.to || to <= from || to > source.length || protectedRanges(source.slice(from, to)).length) throw new Error('Select a prose passage after this beat, outside other blocks.')
  const otherPassages = sceneBeats(source).filter((item) => item.block.id !== beatId).map((item) => beatPassage(source, item.block.id))
  if (otherPassages.some((passage) => passage && passage.from < to && passage.to > from)) throw new Error('That selection overlaps another beat’s passage.')
  const edits = passageMarkers(source).filter((marker) => marker.beatId === beatId).map((marker) => ({ ...marker, insert: '' }))
  edits.push({ from: to, to, beatId, edge: 'end', insert: `\n${passageMarker(beatId, 'end')}\n` })
  edits.push({ from, to: from, beatId, edge: 'start', insert: `\n${passageMarker(beatId, 'start')}\n` })
  let result = source
  for (const edit of edits.sort((a, b) => b.from - a.from || b.to - a.to)) result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to)
  return result
}
