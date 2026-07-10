import type { Question } from './question.model';
import type { ThermometerQuestion } from './thermometer-question.model';
import type { AreaQuestion } from './area-question.model';

export type RadarMode = 'inside' | 'outside';

export interface RadarQuestionSettings {
  mode: RadarMode;
  radiusKm: number;
}

export interface RadarQuestion extends Question {
  type: 'radar';
  applied: RadarQuestionSettings;
  draft: RadarQuestionSettings;
}

export type GameQuestion = RadarQuestion | ThermometerQuestion | AreaQuestion;

export function isRadarQuestion(question: GameQuestion): question is RadarQuestion {
  return question.type === 'radar';
}

export function isThermometerQuestion(question: GameQuestion): question is ThermometerQuestion {
  return question.type === 'thermometer';
}

export function isAreaQuestion(question: GameQuestion): question is AreaQuestion {
  return question.type === 'area';
}

export function isRadarQuestionDirty(question: RadarQuestion): boolean {
  return (
    question.applied.mode !== question.draft.mode ||
    question.applied.radiusKm !== question.draft.radiusKm
  );
}
