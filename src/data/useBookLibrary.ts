import { useEffect, useState } from 'react'
import { ensurePrototypeSeed, ensureSeriesLibrary, listBooks, type BookEntity, type SeriesEntity } from './persistence'

// Loading the home screen must not depend on opening a book, its settings,
// summaries, or Codex. A failure in those features must not hide the library.
export function useBookLibrary(initialStory: string) {
  const [books, setBooks] = useState<BookEntity[]>([])
  const [series, setSeries] = useState<SeriesEntity[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [slow, setSlow] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError('')
    setSlow(false)
    const timer = setTimeout(() => { if (!cancelled) setSlow(true) }, 5000)
    void (async () => {
      try {
        await ensurePrototypeSeed(initialStory)
        const savedBooks = await listBooks()
        if (cancelled) return
        setBooks(savedBooks)
        setState('ready')
        clearTimeout(timer)
        try {
          const savedSeries = await ensureSeriesLibrary()
          const updatedBooks = await listBooks()
          if (cancelled) return
          setSeries(savedSeries)
          setBooks((current) => current === savedBooks ? updatedBooks : current)
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Series information could not be loaded.')
        }
      } catch (cause) {
        if (cancelled) return
        setState('error')
        setError(cause instanceof Error ? cause.message : 'Browser storage could not be opened.')
      } finally {
        clearTimeout(timer)
      }
    })()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [initialStory, attempt])

  return { books, setBooks, series, setSeries, state, error, slow, retry: () => setAttempt((value) => value + 1) }
}
