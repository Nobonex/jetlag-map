import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzRadioModule } from 'ng-zorro-antd/radio';

import { QuestionCardComponent } from '../question-card/question-card.component';
import {
  isRadarQuestionDirty,
  type RadarMode,
  type RadarQuestion,
} from '../../models/radar-question.model';
import { RadarQuestionsService } from '../../services/radar-questions.service';

@Component({
  selector: 'app-radar-question-card',
  imports: [
    FormsModule,
    NzButtonModule,
    NzInputNumberModule,
    NzRadioModule,
    QuestionCardComponent,
  ],
  templateUrl: './radar-question-card.component.html',
  styleUrl: './radar-question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarQuestionCardComponent {
  @Input({ required: true }) question!: RadarQuestion;
  @Input() index = 0;

  @Output() readonly deleteRequest = new EventEmitter<string>();

  private readonly radarQuestionsService = inject(RadarQuestionsService);

  protected isDirty(): boolean {
    return isRadarQuestionDirty(this.question);
  }

  protected onDraftModeChange(mode: RadarMode): void {
    this.radarQuestionsService.updateDraftMode(this.question.id, mode);
  }

  protected onDraftRadiusChange(radiusKm: number | null): void {
    this.radarQuestionsService.updateDraftRadius(this.question.id, radiusKm);
  }

  protected onApply(): void {
    this.radarQuestionsService.applyQuestion(this.question.id);
  }

  protected onToggleCollapsed(questionId: string): void {
    this.radarQuestionsService.toggleQuestionCollapsed(questionId);
  }

  protected onToggleLocked(questionId: string): void {
    this.radarQuestionsService.toggleQuestionLock(questionId);
  }

  protected onTitleChange(event: { questionId: string; title: string }): void {
    this.radarQuestionsService.updateQuestionTitle(event.questionId, event.title);
  }

  protected onDeleteRequest(questionId: string): void {
    this.deleteRequest.emit(questionId);
  }
}
