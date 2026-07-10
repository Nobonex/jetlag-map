import { Injectable, signal } from '@angular/core';

import { CountryBoundaryService } from './country-boundary.service';
import { QuestionsService } from './questions.service';

const SELECTED_COUNTRY_STORAGE_KEY = 'jetlag.selected-country.v1';
const SHARED_STATE_HASH_KEY = 'state';
const SHARED_STATE_VERSION = 1;

@Injectable({ providedIn: 'root' })
export class WorldMapStateService {
  readonly $selectedCountryCode = signal<string | null>(null);

  private readonly countryBoundaryService: CountryBoundaryService;
  private readonly questionsService: QuestionsService;

  constructor(
    countryBoundaryService: CountryBoundaryService,
    questionsService: QuestionsService,
  ) {
    this.countryBoundaryService = countryBoundaryService;
    this.questionsService = questionsService;
  }

  async restoreSelectedCountry(): Promise<void> {
    if (await this.restoreSharedState()) {
      return;
    }

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

  createShareLink(): string {
    const state: SharedWorldMapState = {
      v: SHARED_STATE_VERSION,
      country: this.$selectedCountryCode(),
      questions: this.questionsService.$questions(),
    };
    const url = new URL(globalThis.location.href);
    url.hash = `${SHARED_STATE_HASH_KEY}=${encodeBase64Url(JSON.stringify(state))}`;
    return url.toString();
  }

  clearSavedData(): void {
    this.questionsService.clearQuestions();
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

  private async restoreSharedState(): Promise<boolean> {
    const encodedState = new URLSearchParams(globalThis.location.hash.slice(1)).get(
      SHARED_STATE_HASH_KEY,
    );
    if (!encodedState) {
      return false;
    }

    try {
      const state: unknown = JSON.parse(decodeBase64Url(encodedState));
      if (!isSharedWorldMapState(state)) {
        return false;
      }

      if (state.country && !this.countryBoundaryService.getCountryByCode(state.country)) {
        return false;
      }

      if (!this.questionsService.replaceQuestions(state.questions)) {
        return false;
      }

      this.setSelectedCountry(state.country);
      if (state.country) {
        await this.countryBoundaryService.loadDetailedCountryGeometry(state.country);
      }
      return true;
    } catch {
      return false;
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

interface SharedWorldMapState {
  v: typeof SHARED_STATE_VERSION;
  country: string | null;
  questions: unknown[];
}

function isSharedWorldMapState(value: unknown): value is SharedWorldMapState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const state = value as Partial<SharedWorldMapState>;
  return (
    state.v === SHARED_STATE_VERSION &&
    (state.country === null || typeof state.country === 'string') &&
    Array.isArray(state.questions)
  );
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(paddedBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
