export async function saveRequiredSettingsForLeave(tasks: Array<() => Promise<boolean>>): Promise<boolean> {
  const results = await Promise.all(tasks.map(async (task) => {
    try {
      return await task()
    } catch {
      return false
    }
  }))
  return results.every(Boolean)
}
