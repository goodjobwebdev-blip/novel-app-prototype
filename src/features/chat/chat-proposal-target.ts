export async function loadProposalTargetOrMarkStale<T>(
  load: () => Promise<T>,
  markStale: () => Promise<unknown>,
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    await markStale()
    throw error
  }
}
