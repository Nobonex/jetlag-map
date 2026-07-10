import type { Question, QuestionCenter } from './question.model';

export type AreaMode = 'inside' | 'outside';

export interface AreaQuestion extends Question {
  type: 'area';
  vertices: QuestionCenter[];
  isClosed: boolean;
  applied: {
    mode: AreaMode;
  };
  draft: {
    mode: AreaMode;
  };
}
