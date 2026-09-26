/** Stop must release the caller even if a transport ignores its AbortSignal. */
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    // Observe late failures as well as late results after cancellation.
    pending.then(value => {
      cleanup()
      if (signal.aborted) reject(signal.reason)
      else resolve(value)
    }, error => { cleanup(); reject(signal.aborted ? signal.reason : error) })
  })
}

export async function fetchCompletionResponse(url: string, init: RequestInit, signal: AbortSignal) {
  signal.throwIfAborted()
  const pending = fetch(url, { ...init, signal }).then(response => {
    if (signal.aborted) {
      void response.body?.cancel().catch(() => undefined)
      signal.throwIfAborted()
    }
    return response
  })
  return abortable(pending, signal)
}

/** Read SSE lines with cancellation independent of the provider closing its connection. */
export async function consumeCompletionStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  consumeLine: (line: string) => boolean,
  onResponse?: () => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  const consume = (line: string) => {
    signal.throwIfAborted()
    const done = consumeLine(line)
    signal.throwIfAborted()
    return done
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    onResponse?.()
    while (true) {
      signal.throwIfAborted()
      const read = await abortable(reader.read(), signal)
      signal.throwIfAborted()
      buffer += decoder.decode(read.value, { stream: !read.done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (consume(line)) return
      if (read.done) {
        if (buffer) consume(buffer)
        return
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    // Cancel on DONE and errors too. Never wait for remote cancellation acknowledgement.
    cancel()
    reader.releaseLock()
  }
}

export async function readCompletionError(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted()
  if (!response.body) return null
  try {
    let text = ''
    await consumeCompletionStream(response.body, signal, line => { text += `${line}\n`; return false })
    return JSON.parse(text)
  } catch {
    signal.throwIfAborted()
    return null
  }
}
