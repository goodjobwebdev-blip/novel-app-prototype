import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/** Native modal focus handling, with a viewport that follows the phone keyboard. */
export default function IllustrationModal({ title, onClose, children, footer, fullScreen = false }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; fullScreen?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    const viewport = window.visualViewport
    const resize = () => {
      element.style.setProperty('--image-viewport-height', `${viewport?.height ?? window.innerHeight}px`)
      element.style.setProperty('--image-viewport-top', `${viewport?.offsetTop ?? 0}px`)
    }
    resize()
    element.showModal()
    element.querySelector<HTMLButtonElement>('header button')?.focus({ preventScroll: true })
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    return () => {
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
      document.documentElement.style.overflow = overflow
      element.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className={`image-modal ${fullScreen ? 'image-modal-full' : 'image-modal-sheet'}`} aria-label={title}
    onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="image-modal-panel">
      <header className="image-modal-header"><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X aria-hidden="true" /></button></header>
      <div className="image-modal-content">{children}</div>
      {footer && <footer className="image-modal-footer">{footer}</footer>}
    </section>
  </dialog>, document.body)
}
