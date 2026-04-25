import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzRadioModule } from 'ng-zorro-antd/radio';

import {
  isRadarQuestionDirty,
  type RadarMode,
  type RadarQuestion
} from '../../models/radar-question.model';

@Component({
  selector: 'app-radar-question-card',
  imports: [FormsModule, NzButtonModule, NzIconModule, NzInputNumberModule, NzRadioModule],
  templateUrl: './radar-question-card.component.html',
  styleUrl: './radar-question-card.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush
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

  protected isDirty(): boolean {
    return isRadarQuestionDirty(this.question);
  }

  protected onDraftModeChange(mode: RadarMode): void {
    this.draftModeChange.emit({
      questionId: this.question.id,
      mode
    });
  }

  protected onDraftRadiusChange(radiusKm: number | null): void {
    this.draftRadiusChange.emit({
      questionId: this.question.id,
      radiusKm
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
}
