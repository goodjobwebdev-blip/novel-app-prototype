/** Explicit test setup for the reference-based settings contract. This does not change
 * production defaults or emulate the removed per-book credentials/settings overrides.
 * Modules are arguments so both native-TS and transpiled React tests can use the helper.
 */
export async function assignBookTestProfiles({ persistence, ai, profiles }, bookId, settings, kinds = ['text']) {
  ai.saveAiSettings(settings)
  const configured = profiles.initializeLegacyCharacterRole(ai.copyAiSettings(settings))
  const selections = await persistence.getBookProfileSelections(bookId)
  for (const kind of kinds) {
    const profile = profiles.createSettingsProfile(kind, `Fixture ${kind} · ${bookId}`)
    let value = configured
    if (kind === 'text') {
      const chat = profiles.createSettingsProfile('chat', `Fixture chat prompt · ${bookId}`)
      profiles.saveSettingsProfile({ ...chat, settings: configured })
      value = { ...configured, chatPromptPresetId: chat.id, characterPromptPresetId: profile.settings.characterPromptPresetId }
    }
    profiles.saveSettingsProfile({ ...profile, settings: value })
    selections[kind] = profile.id
  }
  return persistence.saveBookProfileSelections(bookId, selections)
}
