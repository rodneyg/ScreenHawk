export async function shouldShowOnboarding(): Promise<boolean> {
  const { onboardingAcknowledged } = await chrome.storage.local.get({
    onboardingAcknowledged: false,
  });
  return onboardingAcknowledged !== true;
}

export async function acknowledgeOnboarding(): Promise<void> {
  await chrome.storage.local.set({ onboardingAcknowledged: true });
}
