import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';

import { RadarQuestionCardComponent } from '../radar-question-card/radar-question-card.component';
import type { RadarQuestion } from '../../models/radar-question.model';
import { RadarQuestionsService } from '../../services/radar-questions.service';

@Component({
  selector: 'app-questions-sidebar',
  imports: [RadarQuestionCardComponent],
  templateUrl: './questions-sidebar.component.html',
  styleUrl: './questions-sidebar.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionsSidebarComponent {
  @Input({ required: true }) questions: RadarQuestion[] = [];

  private readonly radarQuestionsService = inject(RadarQuestionsService);
  private readonly modalService = inject(NzModalService);

  protected onDeleteRequest(questionId: string): void {
    this.modalService.confirm({
      nzTitle: 'Delete this question?',
      nzContent: 'This will remove the question from the map.',
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.radarQuestionsService.deleteQuestion(questionId),
    });
  }
}
