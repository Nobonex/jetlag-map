import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { IScannerControls } from '@zxing/browser';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';

import { LiveTrackingService } from '../../services/live-tracking.service';

@Component({
  selector: 'app-live-tracking-dialog',
  imports: [FormsModule, NzButtonModule, NzInputModule, NzModalModule],
  templateUrl: './live-tracking-dialog.component.html',
  styleUrl: './live-tracking-dialog.component.less',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveTrackingDialogComponent implements OnDestroy {
  private readonly liveTrackingService = inject(LiveTrackingService);

  readonly visible = input.required<boolean>();
  readonly closed = output<void>();

  protected readonly $role = this.liveTrackingService.$role;
  protected readonly $status = this.liveTrackingService.$status;
  protected readonly $error = this.liveTrackingService.$error;
  protected readonly $participants = this.liveTrackingService.$remoteParticipants;
  protected readonly $invitationCode = this.liveTrackingService.$invitationCode;
  protected readonly $qrDataUrl = signal<string | null>(null);
  protected readonly $copyLabel = signal('Copy code');
  protected readonly $isScanning = signal(false);
  protected readonly $isBusy = signal(false);
  protected sessionInput = '';
  protected displayName = '';

  @ViewChild('scanVideo') private readonly scanVideo?: ElementRef<HTMLVideoElement>;

  private scannerControls: IScannerControls | null = null;

  private readonly stopScannerWhenHiddenEffect = effect(() => {
    if (!this.visible()) {
      this.stopScanner();
    }
  });

  ngOnDestroy(): void {
    void this.stopScannerWhenHiddenEffect;
    this.stopScanner();
  }

  protected close(): void {
    this.stopScanner();
    this.closed.emit();
  }

  protected async createSession(): Promise<void> {
    this.$isBusy.set(true);
    const code = await this.liveTrackingService.createSession(this.displayName);
    this.$isBusy.set(false);
    if (code) {
      await this.createQrCode(code);
    }
  }

  protected async joinSession(): Promise<void> {
    this.$isBusy.set(true);
    const joined = await this.liveTrackingService.joinSession(this.sessionInput, this.displayName);
    this.$isBusy.set(false);
    if (joined) {
      this.$qrDataUrl.set(null);
    }
  }

  protected async retryConnection(): Promise<void> {
    await this.liveTrackingService.reconnect();
  }

  protected async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.$copyLabel.set('Copied');
      setTimeout(() => this.$copyLabel.set('Copy code'), 1600);
    } catch {
      this.$copyLabel.set('Select and copy');
    }
  }

  protected startScanner(): void {
    this.stopScanner();
    this.$isScanning.set(true);
    requestAnimationFrame(() => void this.openCamera());
  }

  protected stopScanner(): void {
    this.scannerControls?.stop();
    this.scannerControls = null;
    this.$isScanning.set(false);
  }

  protected stopSession(): void {
    this.liveTrackingService.stop();
    this.$qrDataUrl.set(null);
  }

  private async openCamera(): Promise<void> {
    const video = this.scanVideo?.nativeElement;
    if (!video) {
      return;
    }

    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      this.scannerControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
        if (!result) {
          return;
        }
        this.sessionInput = result.getText();
        this.stopScanner();
        void this.joinSession();
      });
    } catch {
      this.$isScanning.set(false);
    }
  }

  private async createQrCode(code: string): Promise<void> {
    try {
      const QRCode = await import('qrcode');
      this.$qrDataUrl.set(
        await QRCode.toDataURL(code, { errorCorrectionLevel: 'L', margin: 2, width: 320 }),
      );
    } catch {
      this.$qrDataUrl.set(null);
    }
  }
}
