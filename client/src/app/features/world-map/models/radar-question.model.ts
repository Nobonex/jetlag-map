export interface QuestionCenter {
  lat: number;
  lng: number;
}

export type RadarMode = 'inside' | 'outside';

export interface RadarQuestionSettings {
  mode: RadarMode;
  radiusKm: number;
}

export interface RadarQuestion {
  id: string;
  color: string;
  isCollapsed: boolean;
  isLocked: boolean;
  center: QuestionCenter;
  applied: RadarQuestionSettings;
  draft: RadarQuestionSettings;
  title?: string;
}

export function isRadarQuestionDirty(question: RadarQuestion): boolean {
  return (
    question.applied.mode !== question.draft.mode ||
    question.applied.radiusKm !== question.draft.radiusKm
  );
}
