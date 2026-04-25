import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

import type { BaseQuestion } from '../../models/question.model';

@Component({
  selector: 'app-question-card',
  imports: [FormsModule, NzButtonModule, NzIconModule],
  templateUrl: './question-card.component.html',
  styleUrl: './question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QuestionCardComponent {
  @Input({ required: true }) question!: BaseQuestion;
  @Input() index = 0;
  @Input() typeLabel = 'Question';

  @Output() readonly toggleCollapsed = new EventEmitter<string>();
  @Output() readonly toggleLocked = new EventEmitter<string>();
  @Output() readonly deleteRequest = new EventEmitter<string>();
  @Output() readonly titleChange = new EventEmitter<{
    questionId: string;
    title: string;
  }>();

  @ViewChild('titleInput') private readonly titleInput?: ElementRef<HTMLInputElement>;

  protected isEditingTitle = false;
  protected draftTitle = '';

  protected onToggleCollapsed(): void {
    this.toggleCollapsed.emit(this.question.id);
  }

  protected onToggleLocked(): void {
    this.toggleLocked.emit(this.question.id);
  }

  protected onDelete(): void {
    this.deleteRequest.emit(this.question.id);
  }

  protected startTitleEdit(): void {
    this.draftTitle = this.question.title ?? this.typeLabel;
    this.isEditingTitle = true;
    requestAnimationFrame(() => {
      this.titleInput?.nativeElement.focus();
      this.titleInput?.nativeElement.select();
    });
  }

  protected saveTitle(): void {
    if (!this.isEditingTitle) {
      return;
    }
    this.isEditingTitle = false;
    this.titleChange.emit({
      questionId: this.question.id,
      title: this.draftTitle,
    });
  }

  protected cancelTitleEdit(): void {
    this.isEditingTitle = false;
    this.draftTitle = '';
  }

  protected onTitleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelTitleEdit();
    }
  }

  protected onTitleBlur(): void {
    this.saveTitle();
  }
}
