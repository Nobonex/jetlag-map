export interface QuestionCenter {
  lat: number;
  lng: number;
}

export type QuestionType = 'radar' | 'thermometer';

export interface BaseQuestion {
  id: string;
  color: string;
  type: QuestionType;
  isCollapsed: boolean;
  isLocked: boolean;
  title?: string;
}

export interface Question extends BaseQuestion {
  center: QuestionCenter;
}
