export async function runDeletionSaveBarrier<T>(
  ids: string[],
  deletingIds: Set<string>,
  waitForIdle: (id: string) => Promise<void>,
  action: () => Promise<T>,
): Promise<T> {
  const uniqueIds = [...new Set(ids)]
  uniqueIds.forEach((id) => deletingIds.add(id))
  try {
    await Promise.all(uniqueIds.map((id) => waitForIdle(id)))
    return await action()
  } finally {
    uniqueIds.forEach((id) => deletingIds.delete(id))
  }
}
