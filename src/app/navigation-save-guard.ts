export async function saveRequiredBeforeNavigation(
  needsSave: boolean,
  save: () => Promise<boolean>,
) {
  return !needsSave || await save()
}

export async function navigateAfterRequiredSave(
  needsSave: boolean,
  save: () => Promise<boolean>,
  navigate: () => void,
) {
  if (!await saveRequiredBeforeNavigation(needsSave, save)) return false
  navigate()
  return true
}
