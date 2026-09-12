export type DialogueRange = { from: number; to: number }

const quotePairs: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»', '‹': '›', '„': '“', '‚': '‘' }
const word = /[\p{L}\p{N}\p{M}_]/u

/** Find paired dialogue without treating apostrophes, escaped quotes or hidden metadata as speech. */
export function findDialogueRanges(text: string, excluded: DialogueRange[] = []): DialogueRange[] {
  const blocked = excluded.filter(range => range.to > range.from).sort((a, b) => a.from - b.from)
  const ranges: DialogueRange[] = []
  let active: { from: number; open: string; close: string; continued: DialogueRange[] } | null = null
  let blockedIndex = 0
  for (let index = 0; index < text.length; index++) {
    while (blockedIndex < blocked.length && blocked[blockedIndex].to <= index) blockedIndex++
    if (blockedIndex < blocked.length && blocked[blockedIndex].from <= index) {
      index = blocked[blockedIndex].to - 1
      continue
    }
    const character = text[index]
    if (character === '\\') { index++; continue }
    if (character === '\n') {
      const paragraphBreak = text.slice(index).match(/^\n[\t \r]*\n[\t \r\n]*/)
      if (paragraphBreak) {
        const next = index + paragraphBreak[0].length
        // Continued speeches repeat the opening quote in each paragraph, then close once.
        if (active && text[next] === active.open) {
          active.continued.push({ from: active.from, to: index })
          active.from = next + 1
          index = next
        } else active = null // Do not color unrelated paragraphs after an unfinished quote.
        continue
      }
    }
    const before = text[index - 1] ?? '', after = text[index + 1] ?? ''
    if (active) {
      if (character !== active.close) continue
      if ((character === "'" || character === '’') && word.test(before) && word.test(after)) continue
      if (index > active.from && text.slice(active.from, index).trim()) ranges.push(...active.continued, { from: active.from, to: index })
      active = null
    } else if (quotePairs[character] && !word.test(before) && after && !/\s/.test(after)) {
      active = { from: index + 1, open: character, close: quotePairs[character], continued: [] }
    }
  }
  // Keep inline code, links and metadata unstyled, even when surrounded by dialogue.
  const visible: DialogueRange[] = []
  let skip = 0
  for (const range of ranges) {
    let from = range.from
    while (skip < blocked.length && blocked[skip].to <= from) skip++
    for (let index = skip; index < blocked.length && blocked[index].from < range.to; index++) {
      if (blocked[index].from > from) visible.push({ from, to: blocked[index].from })
      from = Math.max(from, blocked[index].to)
    }
    if (from < range.to) visible.push({ from, to: range.to })
  }
  return visible
}
