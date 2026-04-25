import type { Question } from './question.model';

export type RadarMode = 'inside' | 'outside';

export interface RadarQuestionSettings {
  mode: RadarMode;
  radiusKm: number;
}

export interface RadarQuestion extends Question {
  applied: RadarQuestionSettings;
  draft: RadarQuestionSettings;
}

export function isRadarQuestionDirty(question: RadarQuestion): boolean {
  return (
    question.applied.mode !== question.draft.mode ||
    question.applied.radiusKm !== question.draft.radiusKm
  );
}
