import { useLayoutEffect, useRef, useState } from 'react'
import type { EditorSelectionInfo } from './MarkdownEditor'
import { quickTools, selectionWordCount, type QuickTool } from './quick-tools'

export default function SelectionTools({ selection, open }: { selection: EditorSelectionInfo; open: (tool: QuickTool) => void }) {
  const element = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: selection.rect.left, top: selection.rect.bottom + 8 })
  useLayoutEffect(() => {
    const place = () => {
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight
      const bounds = element.current?.getBoundingClientRect()
      setPosition({ left: Math.max(left + 8, Math.min(selection.rect.left, left + width - (bounds?.width ?? 220) - 8)), top: Math.max(top + 8, Math.min(selection.rect.bottom + 8, top + height - (bounds?.height ?? 50) - 12)) })
    }
    place(); window.visualViewport?.addEventListener('resize', place)
    return () => window.visualViewport?.removeEventListener('resize', place)
  }, [selection])
  const words = selectionWordCount(selection.snapshot.text)
  return <div ref={element} className="selection-tools" role="toolbar" aria-label="Selection tools" style={position} onPointerDown={(event) => { if (event.pointerType === 'mouse') event.preventDefault() }}>
    {selection.protected ? <span>Select prose outside image, comment and beat blocks.</span> : quickTools.filter((tool) => !tool.maxWords || words <= tool.maxWords).map((tool) => <button key={tool.id} type="button" onClick={() => open(tool)}>{tool.label}</button>)}
  </div>
}
