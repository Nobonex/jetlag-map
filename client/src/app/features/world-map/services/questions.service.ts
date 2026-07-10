import { Injectable, signal } from '@angular/core';

import type { QuestionCenter } from '../models/question.model';
import type {
  GameQuestion,
  RadarMode,
  RadarQuestion,
} from '../models/radar-question.model';
import { isAreaQuestion } from '../models/radar-question.model';
import type { ThermometerMode, ThermometerQuestion } from '../models/thermometer-question.model';
import type { AreaMode, AreaQuestion } from '../models/area-question.model';

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
  private nextAreaQuestionId = 1;

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

  addAreaQuestion(start: QuestionCenter): void {
    const questionId = `area-${this.nextAreaQuestionId++}`;
    const color = COLOR_PALETTE[this.$questionsSignal().length % COLOR_PALETTE.length];

    this.$questionsSignal.update((questions) => [
      ...questions,
      {
        id: questionId,
        color,
        type: 'area',
        isCollapsed: false,
        isLocked: false,
        center: start,
        vertices: [start],
        isClosed: false,
        title: 'Area',
        applied: { mode: 'inside' },
        draft: { mode: 'inside' },
      } as AreaQuestion,
    ]);

    this.persistQuestions();
  }

  addAreaVertex(questionId: string, point: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => {
      if (!isAreaQuestion(question) || question.isClosed || question.isLocked) {
        return question;
      }

      const previous = question.vertices[question.vertices.length - 1];
      if (previous && Math.hypot(previous.lat - point.lat, previous.lng - point.lng) < 1e-8) {
        return question;
      }

      return { ...question, vertices: [...question.vertices, point] };
    });
  }

  updateAreaVertex(questionId: string, vertexIndex: number, point: QuestionCenter): void {
    this.updateQuestion(questionId, (question) => {
      if (!isAreaQuestion(question) || !question.vertices[vertexIndex]) {
        return question;
      }

      const vertices = question.vertices.map((vertex, index) =>
        index === vertexIndex ? point : vertex,
      );
      return {
        ...question,
        center: vertexIndex === 0 ? point : question.center,
        vertices,
      };
    });
  }

  closeAreaQuestion(questionId: string): void {
    this.updateQuestion(questionId, (question) =>
      isAreaQuestion(question) && question.vertices.length >= 3
        ? { ...question, isClosed: true }
        : question,
    );
  }

  updateAreaMode(questionId: string, mode: AreaMode): void {
    this.updateQuestion(questionId, (question) =>
      isAreaQuestion(question)
        ? { ...question, applied: { mode }, draft: { mode } }
        : question,
    );
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
      title: trimmed.length > 0 ? trimmed : getDefaultQuestionTitle(question),
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
    this.nextAreaQuestionId = 1;
    this.persistQuestions();
  }

  replaceQuestions(value: unknown): boolean {
    if (!Array.isArray(value) || !value.every(isValidQuestion)) {
      return false;
    }

    this.$questionsSignal.set(value);
    this.nextRadarQuestionId = getNextQuestionId(value, 'radar');
    this.nextThermometerQuestionId = getNextQuestionId(value, 'thermometer');
    this.nextAreaQuestionId = getNextQuestionId(value, 'area');
    this.persistQuestions();
    return true;
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
      this.nextAreaQuestionId = getNextQuestionId(restoredQuestions, 'area');
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
      nextAreaQuestionId: this.nextAreaQuestionId,
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
  nextAreaQuestionId?: number;
  questions: GameQuestion[];
}

function getNextQuestionId(questions: GameQuestion[], type: GameQuestion['type']): number {
  const prefix = `${type}-`;
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

  if (question.type === 'area') {
    const area = question as Partial<AreaQuestion>;
    return (
      typeof area.isClosed === 'boolean' &&
      Array.isArray(area.vertices) &&
      area.vertices.length >= 1 &&
      (!area.isClosed || area.vertices.length >= 3) &&
      area.vertices.every(isQuestionCenter) &&
      isAreaSettings(area.applied) &&
      isAreaSettings(area.draft)
    );
  }

  return false;
}

function isQuestionCenter(value: unknown): value is QuestionCenter {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const center = value as Partial<QuestionCenter>;
  return (
    typeof center.lat === 'number' &&
    Number.isFinite(center.lat) &&
    center.lat >= -90 &&
    center.lat <= 90 &&
    typeof center.lng === 'number' &&
    Number.isFinite(center.lng) &&
    center.lng >= -180 &&
    center.lng <= 180
  );
}

function getDefaultQuestionTitle(question: GameQuestion): string {
  switch (question.type) {
    case 'radar':
      return 'Radar';
    case 'thermometer':
      return 'Thermometer';
    case 'area':
      return 'Area';
  }
}

function isAreaSettings(value: unknown): value is { mode: AreaMode } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const settings = value as { mode?: unknown };
  return settings.mode === 'inside' || settings.mode === 'outside';
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
