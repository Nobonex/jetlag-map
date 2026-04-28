import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';

import { QuestionCardComponent } from '../question-card/question-card.component';
import type { ThermometerMode, ThermometerQuestion } from '../../models/thermometer-question.model';
import { QuestionsService } from '../../services/questions.service';

@Component({
  selector: 'app-thermometer-question-card',
  imports: [FormsModule, NzButtonModule, QuestionCardComponent],
  templateUrl: './thermometer-question-card.component.html',
  styleUrl: './thermometer-question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThermometerQuestionCardComponent {
  @Input({ required: true }) question!: ThermometerQuestion;
  @Input() index = 0;

  @Output() readonly deleteRequest = new EventEmitter<string>();

  private readonly questionsService = inject(QuestionsService);

  protected onModeChange(mode: ThermometerMode): void {
    this.questionsService.updateThermometerMode(this.question.id, mode);
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
