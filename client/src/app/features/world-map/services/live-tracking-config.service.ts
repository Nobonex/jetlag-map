import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LiveTrackingConfigService {
  private apiKeyPromise: Promise<string> | null = null;

  loadApiKey(): Promise<string> {
    this.apiKeyPromise ??= this.fetchApiKey();
    return this.apiKeyPromise;
  }

  private async fetchApiKey(): Promise<string> {
    const response = await fetch('live-tracking-config.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Live tracking configuration could not be loaded');
    }
    const value: unknown = await response.json();
    if (
      typeof value !== 'object' ||
      value === null ||
      !('meteredApiKey' in value) ||
      typeof value.meteredApiKey !== 'string' ||
      !value.meteredApiKey.startsWith('pk_live_')
    ) {
      throw new Error('Live tracking is not configured');
    }
    return value.meteredApiKey;
  }
}
