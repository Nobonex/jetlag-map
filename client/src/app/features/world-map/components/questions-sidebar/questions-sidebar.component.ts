import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';

import { RadarQuestionCardComponent } from '../radar-question-card/radar-question-card.component';
import { ThermometerQuestionCardComponent } from '../thermometer-question-card/thermometer-question-card.component';
import type { GameQuestion } from '../../models/radar-question.model';
import { QuestionsService } from '../../services/questions.service';

@Component({
  selector: 'app-questions-sidebar',
  imports: [RadarQuestionCardComponent, ThermometerQuestionCardComponent],
  templateUrl: './questions-sidebar.component.html',
  styleUrl: './questions-sidebar.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionsSidebarComponent {
  @Input({ required: true }) questions: GameQuestion[] = [];

  private readonly questionsService = inject(QuestionsService);
  private readonly modalService = inject(NzModalService);

  protected getTypeIndex(currentIndex: number): number {
    const currentType = this.questions[currentIndex].type;
    let count = 0;
    for (let i = 0; i < currentIndex; i++) {
      if (this.questions[i].type === currentType) {
        count++;
      }
    }
    return count;
  }

  protected onDeleteRequest(questionId: string): void {
    this.modalService.confirm({
      nzTitle: 'Delete this question?',
      nzContent: 'This will remove the question from the map.',
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.questionsService.deleteQuestion(questionId),
    });
  }
}
