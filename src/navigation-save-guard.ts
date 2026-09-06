export async function navigateAfterRequiredSave(
  needsSave: boolean,
  save: () => Promise<boolean>,
  navigate: () => void,
) {
  if (needsSave && !await save()) return false
  navigate()
  return true
}
