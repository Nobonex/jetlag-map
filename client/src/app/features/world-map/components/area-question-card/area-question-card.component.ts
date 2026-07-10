import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzRadioModule } from 'ng-zorro-antd/radio';

import { QuestionCardComponent } from '../question-card/question-card.component';
import type { AreaMode, AreaQuestion } from '../../models/area-question.model';
import { QuestionsService } from '../../services/questions.service';

@Component({
  selector: 'app-area-question-card',
  imports: [FormsModule, NzRadioModule, QuestionCardComponent],
  templateUrl: './area-question-card.component.html',
  styleUrl: './area-question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AreaQuestionCardComponent {
  @Input({ required: true }) question!: AreaQuestion;
  @Input() index = 0;

  @Output() readonly deleteRequest = new EventEmitter<string>();

  private readonly questionsService = inject(QuestionsService);

  protected onModeChange(mode: AreaMode): void {
    this.questionsService.updateAreaMode(this.question.id, mode);
  }

  protected onToggleCollapsed(questionId: string): void {
    this.questionsService.toggleQuestionCollapsed(questionId);
  }

  protected onToggleLocked(questionId: string): void {
    this.questionsService.toggleQuestionLock(questionId);
  }

  protected onTitleChange(event: { questionId: string; title: string }): void {
    this.questionsService.updateQuestionTitle(event.questionId, event.title);
  }

  protected onDeleteRequest(questionId: string): void {
    this.deleteRequest.emit(questionId);
  }
}
