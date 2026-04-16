import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { RadarQuestionCardComponent } from '../radar-question-card/radar-question-card.component';
import type { RadarQuestion } from '../../models/radar-question.model';
import { RadarQuestionsService } from '../../services/radar-questions.service';

@Component({
  selector: 'app-questions-sidebar',
  imports: [RadarQuestionCardComponent],
  templateUrl: './questions-sidebar.component.html',
  styleUrl: './questions-sidebar.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QuestionsSidebarComponent {
  @Input({ required: true }) questions: RadarQuestion[] = [];

  private readonly radarQuestionsService = inject(RadarQuestionsService);

  protected onDraftModeChange(event: {
    questionId: string;
    mode: 'inside' | 'outside';
  }): void {
    this.radarQuestionsService.updateDraftMode(event.questionId, event.mode);
  }

  protected onDraftRadiusChange(event: {
    questionId: string;
    radiusKm: number | null;
  }): void {
    this.radarQuestionsService.updateDraftRadius(event.questionId, event.radiusKm);
  }

  protected onApply(questionId: string): void {
    this.radarQuestionsService.applyQuestion(questionId);
  }

  protected onToggleCollapsed(questionId: string): void {
    this.radarQuestionsService.toggleQuestionCollapsed(questionId);
  }

  protected onToggleLocked(questionId: string): void {
    this.radarQuestionsService.toggleQuestionLock(questionId);
  }
}
