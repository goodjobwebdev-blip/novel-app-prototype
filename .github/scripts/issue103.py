from pathlib import Path

path = Path('src/tts-service.ts')
text = path.read_text()
old = """  const deferred = chunks.map(() => {
    let resolve!: (value: { url: string; objectUrl: boolean }) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<{ url: string; objectUrl: boolean }>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject, ready: false }
  })
  let nextIndex = 0
  const concurrency = Math.max(1, Math.min(8, Number.parseInt(settings.maxParallelRequests, 10) || 1))
  const worker = async () => {
    while (currentSession === sessionId) {
      const index = nextIndex++
      if (index >= chunks.length) return
      try {
        const result = await requestChunk(settings, chunks[index], controller.signal)
        deferred[index].ready = true
        deferred[index].resolve(result)
      } catch (error) {
        deferred[index].reject(error)
        throw error
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())

  try {
    for (let index = 0; index < deferred.length; index += 1) {
      if (!deferred[index].ready && index > 0) emit({ status: 'waiting', label, chunkIndex: index, chunkCount: count })
      const generated = await deferred[index].promise
      await playAudio(generated.url, currentSession, index + 1, count, label)
      if (generated.objectUrl) {
        URL.revokeObjectURL(generated.url)
        objectUrls.delete(generated.url)
      }
    }
    await Promise.all(workers)
    if (currentSession === sessionId) emit({ status: 'complete', label, chunkIndex: count, chunkCount: count })
  } catch (error) {
    if (controller.signal.aborted || currentSession !== sessionId) return
    const message = error instanceof Error ? error.message : 'Text-to-speech failed.'
    emit({ status: 'failed', label, chunkIndex: state.chunkIndex, chunkCount: count, error: message })
    throw error
  } finally {
    if (currentSession === sessionId) {
      activeController = null
      activeAudio = null
      cleanupObjectUrls()
    }
  }
"""
new = """  const deferred = chunks.map(() => {
    let resolve!: (value: { url: string; objectUrl: boolean }) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<{ url: string; objectUrl: boolean }>((res, rej) => { resolve = res; reject = rej })
    // Workers may reject chunks that the ordered playback loop never reaches after a fatal failure.
    // Mark every deferred rejection as observed while preserving rejection for later awaiters.
    void promise.catch(() => undefined)
    return { promise, resolve, reject, ready: false }
  })
  let nextIndex = 0
  let fatalError: unknown
  const concurrency = Math.max(1, Math.min(8, Number.parseInt(settings.maxParallelRequests, 10) || 1))
  const worker = async () => {
    while (currentSession === sessionId && !controller.signal.aborted) {
      const index = nextIndex++
      if (index >= chunks.length) return
      try {
        const result = await requestChunk(settings, chunks[index], controller.signal)
        if (controller.signal.aborted || currentSession !== sessionId || fatalError !== undefined) {
          if (result.objectUrl) {
            URL.revokeObjectURL(result.url)
            objectUrls.delete(result.url)
          }
          return
        }
        deferred[index].ready = true
        deferred[index].resolve(result)
      } catch (error) {
        deferred[index].reject(error)
        if (!controller.signal.aborted && currentSession === sessionId && fatalError === undefined) {
          fatalError = error
          controller.abort()
        }
        return
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker())

  try {
    for (let index = 0; index < deferred.length; index += 1) {
      if (!deferred[index].ready && index > 0) emit({ status: 'waiting', label, chunkIndex: index, chunkCount: count })
      const generated = await deferred[index].promise
      await playAudio(generated.url, currentSession, index + 1, count, label)
      if (generated.objectUrl) {
        URL.revokeObjectURL(generated.url)
        objectUrls.delete(generated.url)
      }
    }
    await Promise.allSettled(workers)
    if (currentSession === sessionId) emit({ status: 'complete', label, chunkIndex: count, chunkCount: count })
  } catch (error) {
    const userCancelled = currentSession !== sessionId || (controller.signal.aborted && fatalError === undefined)
    if (!userCancelled && fatalError === undefined) {
      fatalError = error
      controller.abort()
    }
    await Promise.allSettled(workers)
    if (userCancelled) return
    const failure = fatalError ?? error
    const message = failure instanceof Error ? failure.message : 'Text-to-speech failed.'
    if (currentSession === sessionId) emit({ status: 'failed', label, chunkIndex: state.chunkIndex, chunkCount: count, error: message })
    throw failure
  } finally {
    if (currentSession === sessionId) {
      activeController = null
      activeAudio = null
      cleanupObjectUrls()
    }
  }
"""
if old not in text:
    raise SystemExit('issue103 target block not found')
path.write_text(text.replace(old, new, 1))
