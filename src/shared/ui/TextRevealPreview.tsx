import { useEffect, useState } from 'react'
const words = 'The last light lingered on the water as she opened the letter.'.split(' ')
export function TextRevealPreview({ delay }: { delay: number }) {
  const [count, setCount] = useState(words.length)
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (!run) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setCount(words.length); return }
    setCount(0)
    let shown = 0
    const timer = window.setInterval(() => { shown += 1; setCount(shown); if (shown >= words.length) window.clearInterval(timer) }, Math.max(1, Math.min(2000, delay || 40)))
    return () => window.clearInterval(timer)
  }, [run, delay])
  return <div className="reveal-preview"><p aria-label={words.join(' ')}><span aria-hidden="true">{words.slice(0, count).join(' ')}</span></p><button type="button" onClick={() => setRun(value => value + 1)}>Preview speed</button></div>
}
