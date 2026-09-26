export function applyIfStillCurrent(expectedId: string, currentId: () => string | null | undefined, apply: () => void) {
  if (currentId() !== expectedId) return false
  apply()
  return true
}
