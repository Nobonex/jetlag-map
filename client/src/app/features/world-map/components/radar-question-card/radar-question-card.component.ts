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
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzRadioModule } from 'ng-zorro-antd/radio';

import {
  isRadarQuestionDirty,
  type RadarMode,
  type RadarQuestion,
} from '../../models/radar-question.model';

@Component({
  selector: 'app-radar-question-card',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputNumberModule, NzRadioModule],
  templateUrl: './radar-question-card.component.html',
  styleUrl: './radar-question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RadarQuestionCardComponent {
  @Input({ required: true }) question!: RadarQuestion;
  @Input() index = 0;

  @Output() readonly draftModeChange = new EventEmitter<{
    questionId: string;
    mode: RadarMode;
  }>();
  @Output() readonly draftRadiusChange = new EventEmitter<{
    questionId: string;
    radiusKm: number | null;
  }>();
  @Output() readonly apply = new EventEmitter<string>();
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

  protected isDirty(): boolean {
    return isRadarQuestionDirty(this.question);
  }

  protected onDraftModeChange(mode: RadarMode): void {
    this.draftModeChange.emit({
      questionId: this.question.id,
      mode,
    });
  }

  protected onDraftRadiusChange(radiusKm: number | null): void {
    this.draftRadiusChange.emit({
      questionId: this.question.id,
      radiusKm,
    });
  }

  protected onApply(): void {
    this.apply.emit(this.question.id);
  }

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
    this.draftTitle = this.question.title ?? 'Radar';
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
