import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';

import { LiveTrackingService } from '../../services/live-tracking.service';

@Component({
  selector: 'app-live-tracking-status',
  templateUrl: './live-tracking-status.component.html',
  styleUrl: './live-tracking-status.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveTrackingStatusComponent {
  private readonly liveTrackingService = inject(LiveTrackingService);

  readonly opened = output<void>();

  protected readonly $role = this.liveTrackingService.$role;
  protected readonly $status = this.liveTrackingService.$status;
  protected readonly $participants = this.liveTrackingService.$remoteParticipants;

  protected stop(): void {
    this.liveTrackingService.stop();
  }
}
