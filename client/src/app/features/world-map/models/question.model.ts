export interface QuestionCenter {
  lat: number;
  lng: number;
}

export interface BaseQuestion {
  id: string;
  color: string;
  type: 'radar';
  isCollapsed: boolean;
  isLocked: boolean;
  title?: string;
}

export interface Question extends BaseQuestion {
  center: QuestionCenter;
}
