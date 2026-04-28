import type { Question, QuestionCenter } from './question.model';

export type ThermometerMode = 'warmer' | 'colder';

export interface ThermometerQuestion extends Question {
  start: QuestionCenter;
  end: QuestionCenter;
  applied: {
    mode: ThermometerMode;
  };
  draft: {
    mode: ThermometerMode;
  };
}

export function isThermometerQuestionDirty(question: ThermometerQuestion): boolean {
  return question.applied.mode !== question.draft.mode;
}
