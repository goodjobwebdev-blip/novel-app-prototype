import { useLayoutEffect, useRef, useState } from 'react'
import type { EditorSelectionInfo } from './MarkdownEditor'
import { quickTools, selectionWordCount, type QuickTool } from './quick-tools'

export default function SelectionTools({ selection, open }: { selection: EditorSelectionInfo; open: (tool: QuickTool) => void }) {
  const element = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [position, setPosition] = useState({ left: selection.rect.left, top: selection.rect.bottom + 10, maxHeight: 240 })
  useLayoutEffect(() => {
    const place = () => {
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const below = top + height - selection.rect.bottom - 20
      const above = selection.rect.top - top - 20
      const wanted = expanded ? 240 : 46
      const useBelow = below >= wanted || below >= above
      const maxHeight = Math.min(wanted, Math.max(46, useBelow ? below : above))
      const measured = Math.min(element.current?.scrollHeight || wanted, maxHeight)
      setPosition({ left: Math.max(left + 8, Math.min(selection.rect.left, left + width - (expanded ? 204 : 128) - 8)), top: Math.max(top + 8, useBelow ? selection.rect.bottom + 10 : selection.rect.top - measured - 10), maxHeight })
    }
    place()
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => { window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place) }
  }, [selection, expanded])
  useLayoutEffect(() => { setExpanded(false) }, [selection.snapshot.from, selection.snapshot.to, selection.snapshot.revision])
  const words = selectionWordCount(selection.snapshot.text)
  return <div ref={element} className={`selection-tools ${expanded ? 'expanded' : ''}`} role="toolbar" aria-label="Selection tools" style={position} onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault() }} onKeyDown={event => { if (event.key === 'Escape') { setExpanded(false); element.current?.querySelector('button')?.focus() } }}>
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Close tools' : 'Rewrite…'}</button>
    {expanded && (selection.protected ? <span>Select prose outside image, comment and beat blocks.</span> : quickTools.filter((tool) => !tool.maxWords || (words > 0 && words <= tool.maxWords)).map((tool) => <button key={tool.id} type="button" onClick={() => open(tool)}>{tool.label}</button>))}
  </div>
}
