export type ChatSendPipelineResult<TPersisted> = {
  persisted: TPersisted
  postPersistError?: unknown
}

export async function runChatSendPipeline<TPrepared, TPersisted>(options: {
  preflight: () => Promise<TPrepared>
  persist: (prepared: TPrepared) => Promise<TPersisted>
  generate: (prepared: TPrepared, persisted: TPersisted) => Promise<void>
  onPostPersistError?: (error: unknown, persisted: TPersisted) => void | Promise<void>
}): Promise<ChatSendPipelineResult<TPersisted>> {
  const prepared = await options.preflight()
  const persisted = await options.persist(prepared)
  try {
    await options.generate(prepared, persisted)
    return { persisted }
  } catch (error) {
    await options.onPostPersistError?.(error, persisted)
    return { persisted, postPersistError: error }
  }
}
