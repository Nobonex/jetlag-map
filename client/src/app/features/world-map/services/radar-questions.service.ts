import { Injectable, signal } from '@angular/core';

import type {
  QuestionCenter,
  RadarMode,
  RadarQuestion
} from '../models/radar-question.model';

const DEFAULT_RADAR_RADIUS_KM = 50;
const RADAR_COLOR_PALETTE = [
  '#1f8b5d',
  '#d97706',
  '#2563eb',
  '#c026d3',
  '#dc2626',
  '#0891b2'
] as const;
const RADAR_QUESTIONS_STORAGE_KEY = 'jetlag.radar-questions.v1';

@Injectable({ providedIn: 'root' })
export class RadarQuestionsService {
  private readonly questionsSignal = signal<RadarQuestion[]>([]);
  readonly questions = this.questionsSignal.asReadonly();
  private nextRadarQuestionId = 1;

  constructor() {
    this.restoreQuestions();
  }

  addRadarQuestion(center: QuestionCenter): void {
    const questionId = `radar-${this.nextRadarQuestionId++}`;
    const color =
      RADAR_COLOR_PALETTE[this.questionsSignal().length % RADAR_COLOR_PALETTE.length];

    this.questionsSignal.update((questions) => [
      ...questions,
      {
        id: questionId,
        color,
        isCollapsed: false,
        isLocked: false,
        center,
        applied: {
          mode: 'inside',
          radiusKm: DEFAULT_RADAR_RADIUS_KM
        },
        draft: {
          mode: 'inside',
          radiusKm: DEFAULT_RADAR_RADIUS_KM
        }
      }
    ]);

    this.persistQuestions();
  }

  updateDraftMode(questionId: string, mode: RadarMode): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      draft: {
        ...question.draft,
        mode
      }
    }));
  }

  updateDraftRadius(questionId: string, radiusKm: number | null): void {
    if (radiusKm === null || Number.isNaN(radiusKm)) {
      return;
    }

    this.updateQuestion(questionId, (question) => ({
      ...question,
      draft: {
        ...question.draft,
        radiusKm: clamp(radiusKm, 1, 5000)
      }
    }));
  }

  applyQuestion(questionId: string): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      applied: {
        ...question.draft
      }
    }));
  }

  toggleQuestionCollapsed(questionId: string): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      isCollapsed: !question.isCollapsed
    }));
  }

  toggleQuestionLock(questionId: string): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      isLocked: !question.isLocked
    }));
  }

  updateQuestionCenter(questionId: string, center: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      center
    }));
  }

  clearQuestions(): void {
    this.questionsSignal.set([]);
    this.nextRadarQuestionId = 1;
    this.persistQuestions();
  }

  private updateQuestion(
    questionId: string,
    updater: (question: RadarQuestion) => RadarQuestion
  ): void {
    this.questionsSignal.update((questions) =>
      questions.map((question) =>
        question.id === questionId ? updater(question) : question
      )
    );

    this.persistQuestions();
  }

  private restoreQuestions(): void {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    const rawValue = storage.getItem(RADAR_QUESTIONS_STORAGE_KEY);
    if (!rawValue) {
      return;
    }

    try {
      const parsedValue = JSON.parse(rawValue) as PersistedRadarQuestions | null;
      if (!parsedValue || !Array.isArray(parsedValue.questions)) {
        return;
      }

      const restoredQuestions = parsedValue.questions.filter(isRadarQuestion);
      this.questionsSignal.set(restoredQuestions);
      this.nextRadarQuestionId = getNextRadarQuestionId(
        restoredQuestions,
        parsedValue.nextRadarQuestionId
      );
    } catch {
      storage.removeItem(RADAR_QUESTIONS_STORAGE_KEY);
    }
  }

  private persistQuestions(): void {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    const payload: PersistedRadarQuestions = {
      nextRadarQuestionId: this.nextRadarQuestionId,
      questions: this.questionsSignal()
    };

    storage.setItem(RADAR_QUESTIONS_STORAGE_KEY, JSON.stringify(payload));
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getStorage(): Storage | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null;
  }

  return globalThis.localStorage;
}

interface PersistedRadarQuestions {
  nextRadarQuestionId?: number;
  questions: RadarQuestion[];
}

function getNextRadarQuestionId(
  questions: RadarQuestion[],
  persistedNextRadarQuestionId?: number
): number {
  if (
    typeof persistedNextRadarQuestionId === 'number' &&
    Number.isInteger(persistedNextRadarQuestionId) &&
    persistedNextRadarQuestionId > 0
  ) {
    return persistedNextRadarQuestionId;
  }

  const highestNumericId = questions.reduce((maxId, question) => {
    const numericId = Number.parseInt(question.id.replace(/^radar-/, ''), 10);
    return Number.isFinite(numericId) ? Math.max(maxId, numericId) : maxId;
  }, 0);

  return highestNumericId + 1;
}

function isRadarQuestion(value: unknown): value is RadarQuestion {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const question = value as Partial<RadarQuestion>;
  return (
    typeof question.id === 'string' &&
    typeof question.color === 'string' &&
    typeof question.isCollapsed === 'boolean' &&
    typeof question.isLocked === 'boolean' &&
    isQuestionCenter(question.center) &&
    isRadarSettings(question.applied) &&
    isRadarSettings(question.draft)
  );
}

function isQuestionCenter(value: unknown): value is QuestionCenter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const center = value as Partial<QuestionCenter>;
  return typeof center.lat === 'number' && typeof center.lng === 'number';
}

function isRadarSettings(
  value: unknown
): value is { mode: RadarMode; radiusKm: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as { mode?: unknown; radiusKm?: unknown };
  return (
    (settings.mode === 'inside' || settings.mode === 'outside') &&
    typeof settings.radiusKm === 'number'
  );
}
