export class KeyedAsyncQueue {
  private tails = new Map<string, Promise<void>>()

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const tail = previous.catch(() => undefined).then(() => barrier)
    this.tails.set(key, tail)

    await previous.catch(() => undefined)
    try {
      return await task()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }

  async whenIdle(key: string): Promise<void> {
    await (this.tails.get(key) ?? Promise.resolve()).catch(() => undefined)
  }
}
