import { useLayoutEffect, useRef, type ReactNode } from 'react'

/** Shared layout for Chat, Story and Codex. Reserves its actual height in the page. */
export default function Composer({ strip, children, className = '', rowClassName = 'chat-compose-row' }: {
  strip: ReactNode; children: ReactNode; className?: string; rowClassName?: string
}) {
  const element = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const node = element.current
    const page = node?.closest('main')
    if (!node || !page) return
    const resize = () => page.style.setProperty('--composer-height', `${node.getBoundingClientRect().height}px`)
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(node)
    return () => { observer?.disconnect(); page.style.removeProperty('--composer-height') }
  }, [])
  return <section ref={element} className={`composer-shell chat-composer functional-chat-composer ${className}`}>
    {strip}
    <div className={rowClassName}>{children}</div>
  </section>
}
