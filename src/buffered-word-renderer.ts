type BufferedWordRendererOptions = {
  delayMs: number
  signal: AbortSignal
  onInsert: (text: string) => void
  onError?: (error: unknown) => void
}

export type BufferedWordRenderer = {
  push: (text: string) => void
  finish: () => Promise<void>
  flush: () => Promise<void>
  error: () => unknown
}

/**
 * Smooths arbitrary provider chunks into complete word-sized editor updates.
 * Slow streams still appear as soon as a full word arrives; bursts are paced.
 */
export function createBufferedWordRenderer({
  delayMs,
  signal,
  onInsert,
  onError,
}: BufferedWordRendererOptions): BufferedWordRenderer {
  let buffer = ''
  let sourceEnded = false
  let settled = false
  let failure: unknown = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastInsertAt: number | null = null
  let resolveDone: () => void
  let rejectDone: (error: unknown) => void

  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  // The renderer can fail while the network request is still active. The caller
  // observes the same rejection when it awaits finish/flush.
  void done.catch(() => undefined)

  function complete(error?: unknown) {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', handleAbort)
    if (timer) clearTimeout(timer)
    timer = null
    if (error !== undefined) rejectDone(error)
    else resolveDone()
  }

  function insert(text: string) {
    if (!text) return true
    try {
      onInsert(text)
      lastInsertAt = Date.now()
      return true
    } catch (error) {
      failure = error
      onError?.(error)
      complete(error)
      return false
    }
  }

  function takeWord() {
    const match = buffer.match(/^\s*\S+\s+/)
    if (match) {
      buffer = buffer.slice(match[0].length)
      return match[0]
    }
    if (sourceEnded && buffer) {
      const tail = buffer
      buffer = ''
      return tail
    }
    return ''
  }

  function hasWordReady() {
    return /^\s*\S+\s+/.test(buffer) || (sourceEnded && buffer.length > 0)
  }

  function pump() {
    if (settled || timer) return
    if (!hasWordReady()) {
      if (sourceEnded && !buffer) complete()
      return
    }

    const wait = lastInsertAt === null ? 0 : Math.max(0, delayMs - (Date.now() - lastInsertAt))
    timer = setTimeout(() => {
      timer = null
      const word = takeWord()
      if (insert(word)) pump()
    }, wait)
  }

  function flushNow() {
    if (settled) return
    sourceEnded = true
    if (timer) clearTimeout(timer)
    timer = null
    const remainder = buffer
    buffer = ''
    if (insert(remainder)) complete()
  }

  function handleAbort() {
    flushNow()
  }

  signal.addEventListener('abort', handleAbort, { once: true })
  if (signal.aborted) handleAbort()

  return {
    push(text) {
      if (!text || sourceEnded || settled) return
      buffer += text
      pump()
    },
    finish() {
      if (!settled) {
        sourceEnded = true
        pump()
      }
      return done
    },
    flush() {
      flushNow()
      return done
    },
    error() {
      return failure
    },
  }
}
