import { Injectable, signal } from '@angular/core';

import { CountryBoundaryService } from './country-boundary.service';
import { RadarQuestionsService } from './radar-questions.service';

const SELECTED_COUNTRY_STORAGE_KEY = 'jetlag.selected-country.v1';

@Injectable({ providedIn: 'root' })
export class WorldMapStateService {
  readonly $selectedCountryCode = signal<string | null>(null);

  private readonly countryBoundaryService: CountryBoundaryService;
  private readonly radarQuestionsService: RadarQuestionsService;

  constructor(
    countryBoundaryService: CountryBoundaryService,
    radarQuestionsService: RadarQuestionsService,
  ) {
    this.countryBoundaryService = countryBoundaryService;
    this.radarQuestionsService = radarQuestionsService;
  }

  async restoreSelectedCountry(): Promise<void> {
    const storedCountryCode = this.getPersistedSelectedCountry();
    if (!storedCountryCode) {
      return;
    }

    if (!this.countryBoundaryService.getCountryByCode(storedCountryCode)) {
      this.persistSelectedCountry(null);
      return;
    }

    this.$selectedCountryCode.set(storedCountryCode);
    await this.countryBoundaryService.loadDetailedCountryGeometry(storedCountryCode);
  }

  setSelectedCountry(countryCode: string | null): void {
    this.$selectedCountryCode.set(countryCode);
    this.persistSelectedCountry(countryCode);
  }

  clearSavedData(): void {
    this.radarQuestionsService.clearQuestions();
    this.countryBoundaryService.clearDetailedCountryGeometryCache();
    this.$selectedCountryCode.set(null);
    this.persistSelectedCountry(null);
  }

  private getPersistedSelectedCountry(): string | null {
    try {
      return globalThis.localStorage?.getItem(SELECTED_COUNTRY_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  }

  private persistSelectedCountry(countryCode: string | null): void {
    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        return;
      }

      if (countryCode) {
        storage.setItem(SELECTED_COUNTRY_STORAGE_KEY, countryCode);
        return;
      }

      storage.removeItem(SELECTED_COUNTRY_STORAGE_KEY);
    } catch {
      // Ignore storage-access failures.
    }
  }
}
