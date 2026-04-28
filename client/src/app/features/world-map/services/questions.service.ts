import { Injectable, signal } from '@angular/core';

import type { QuestionCenter } from '../models/question.model';
import type {
  GameQuestion,
  RadarMode,
  RadarQuestion,
} from '../models/radar-question.model';
import type { ThermometerMode, ThermometerQuestion } from '../models/thermometer-question.model';

const DEFAULT_RADAR_RADIUS_KM = 50;
const COLOR_PALETTE = [
  '#1f8b5d',
  '#d97706',
  '#2563eb',
  '#c026d3',
  '#dc2626',
  '#0891b2',
] as const;
const QUESTIONS_STORAGE_KEY = 'jetlag.radar-questions.v1';

@Injectable({ providedIn: 'root' })
export class QuestionsService {
  private readonly $questionsSignal = signal<GameQuestion[]>([]);
  readonly $questions = this.$questionsSignal.asReadonly();
  private nextRadarQuestionId = 1;
  private nextThermometerQuestionId = 1;

  constructor() {
    this.restoreQuestions();
  }

  addRadarQuestion(center: QuestionCenter): void {
    const questionId = `radar-${this.nextRadarQuestionId++}`;
    const color = COLOR_PALETTE[this.$questionsSignal().length % COLOR_PALETTE.length];

    this.$questionsSignal.update((questions) => [
      ...questions,
      {
        id: questionId,
        color,
        type: 'radar',
        isCollapsed: false,
        isLocked: false,
        center,
        title: 'Radar',
        applied: {
          mode: 'inside',
          radiusKm: DEFAULT_RADAR_RADIUS_KM,
        },
        draft: {
          mode: 'inside',
          radiusKm: DEFAULT_RADAR_RADIUS_KM,
        },
      } as RadarQuestion,
    ]);

    this.persistQuestions();
  }

  addThermometerQuestion(start: QuestionCenter, end: QuestionCenter): void {
    const questionId = `thermometer-${this.nextThermometerQuestionId++}`;
    const color = COLOR_PALETTE[this.$questionsSignal().length % COLOR_PALETTE.length];

    this.$questionsSignal.update((questions) => [
      ...questions,
      {
        id: questionId,
        color,
        type: 'thermometer',
        isCollapsed: false,
        isLocked: false,
        center: start,
        start,
        end,
        title: 'Thermometer',
        applied: {
          mode: 'warmer',
        },
        draft: {
          mode: 'warmer',
        },
      } as ThermometerQuestion,
    ]);

    this.persistQuestions();
  }

  updateDraftMode(questionId: string, mode: RadarMode): void {
    this.updateQuestion(questionId, (question) =>
      ({
        ...question,
        draft: {
          ...question.draft,
          mode,
        },
      }) as GameQuestion,
    );
  }

  updateDraftRadius(questionId: string, radiusKm: number | null): void {
    if (radiusKm === null || Number.isNaN(radiusKm)) {
      return;
    }

    this.updateQuestion(questionId, (question) =>
      ({
        ...question,
        draft: {
          ...question.draft,
          radiusKm: clamp(radiusKm, 1, 5000),
        },
      }) as GameQuestion,
    );
  }

  applyQuestion(questionId: string): void {
    this.updateQuestion(questionId, (question) =>
      ({
        ...question,
        applied: {
          ...question.draft,
        },
      }) as GameQuestion,
    );
  }

  toggleQuestionCollapsed(questionId: string): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      isCollapsed: !question.isCollapsed,
    }));
  }

  toggleQuestionLock(questionId: string): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      isLocked: !question.isLocked,
    }));
  }

  updateQuestionCenter(questionId: string, center: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      center,
    }));
  }

  updateThermometerStart(questionId: string, start: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      center: start,
      start,
    }));
  }

  updateThermometerEnd(questionId: string, end: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => ({
      ...question,
      end,
    }));
  }

  updateThermometerMode(questionId: string, mode: ThermometerMode): void {
    this.updateQuestion(questionId, (question) =>
      ({
        ...question,
        applied: {
          ...question.applied,
          mode,
        },
        draft: {
          ...question.draft,
          mode,
        },
      }) as GameQuestion,
    );
  }

  updateQuestionTitle(questionId: string, title: string): void {
    const trimmed = title.trim();
    this.updateQuestion(questionId, (question) => ({
      ...question,
      title: trimmed.length > 0 ? trimmed : question.type === 'radar' ? 'Radar' : 'Thermometer',
    }));
  }

  deleteQuestion(questionId: string): void {
    this.$questionsSignal.update((questions) => questions.filter((q) => q.id !== questionId));
    this.persistQuestions();
  }

  clearQuestions(): void {
    this.$questionsSignal.set([]);
    this.nextRadarQuestionId = 1;
    this.nextThermometerQuestionId = 1;
    this.persistQuestions();
  }

  private updateQuestion(
    questionId: string,
    updater: (question: GameQuestion) => GameQuestion,
  ): void {
    this.$questionsSignal.update((questions) =>
      questions.map((question) => (question.id === questionId ? updater(question) : question)),
    );

    this.persistQuestions();
  }

  private restoreQuestions(): void {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    const rawValue = storage.getItem(QUESTIONS_STORAGE_KEY);
    if (!rawValue) {
      return;
    }

    try {
      const parsedValue = JSON.parse(rawValue) as PersistedQuestions | null;
      if (!parsedValue || !Array.isArray(parsedValue.questions)) {
        return;
      }

      const restoredQuestions = parsedValue.questions.filter(isValidQuestion);
      this.$questionsSignal.set(restoredQuestions);

      this.nextRadarQuestionId = getNextQuestionId(restoredQuestions, 'radar');
      this.nextThermometerQuestionId = getNextQuestionId(restoredQuestions, 'thermometer');
    } catch {
      storage.removeItem(QUESTIONS_STORAGE_KEY);
    }
  }

  private persistQuestions(): void {
    const storage = getStorage();
    if (!storage) {
      return;
    }

    const payload: PersistedQuestions = {
      nextRadarQuestionId: this.nextRadarQuestionId,
      nextThermometerQuestionId: this.nextThermometerQuestionId,
      questions: this.$questionsSignal(),
    };

    storage.setItem(QUESTIONS_STORAGE_KEY, JSON.stringify(payload));
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

interface PersistedQuestions {
  nextRadarQuestionId?: number;
  nextThermometerQuestionId?: number;
  questions: GameQuestion[];
}

function getNextQuestionId(questions: GameQuestion[], type: 'radar' | 'thermometer'): number {
  const prefix = type === 'radar' ? 'radar-' : 'thermometer-';
  const highestNumericId = questions.reduce((maxId, question) => {
    if (!question.id.startsWith(prefix)) {
      return maxId;
    }
    const numericId = Number.parseInt(question.id.replace(prefix, ''), 10);
    return Number.isFinite(numericId) ? Math.max(maxId, numericId) : maxId;
  }, 0);

  return highestNumericId + 1;
}

function isValidQuestion(value: unknown): value is GameQuestion {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const question = value as Partial<GameQuestion>;
  if (
    typeof question.id !== 'string' ||
    typeof question.color !== 'string' ||
    typeof question.isCollapsed !== 'boolean' ||
    typeof question.isLocked !== 'boolean' ||
    !isQuestionCenter(question.center)
  ) {
    return false;
  }

  if (question.type === 'radar') {
    return isRadarSettings(question.applied) && isRadarSettings(question.draft);
  }

  if (question.type === 'thermometer') {
    const thermometer = question as Partial<ThermometerQuestion>;
    return (
      isQuestionCenter(thermometer.start) &&
      isQuestionCenter(thermometer.end) &&
      isThermometerSettings(thermometer.applied) &&
      isThermometerSettings(thermometer.draft)
    );
  }

  return false;
}

function isQuestionCenter(value: unknown): value is QuestionCenter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const center = value as Partial<QuestionCenter>;
  return typeof center.lat === 'number' && typeof center.lng === 'number';
}

function isRadarSettings(value: unknown): value is { mode: 'inside' | 'outside'; radiusKm: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as { mode?: unknown; radiusKm?: unknown };
  return (
    (settings.mode === 'inside' || settings.mode === 'outside') &&
    typeof settings.radiusKm === 'number'
  );
}

function isThermometerSettings(value: unknown): value is { mode: 'warmer' | 'colder' } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as { mode?: unknown };
  return settings.mode === 'warmer' || settings.mode === 'colder';
}
