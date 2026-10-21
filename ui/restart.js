export function resolveSettingsRestart(currentSettings, proposedSettings, confirmed) {
  if (!confirmed || !proposedSettings) return currentSettings;
  return {
    ...proposedSettings,
    disabledItems: [...(proposedSettings.disabledItems || [])]
  };
}
