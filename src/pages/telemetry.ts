export const telemetry = {
  startJourney: async (): Promise<void> => undefined,
  appReady: (): void => undefined,
  progress: (_event: unknown): void => undefined,
  interaction: (_event: unknown): void => undefined,
  endJourney: (_event: unknown): void => undefined,
};
