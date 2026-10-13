import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { GateRefusalDialogComponent } from '../components/gate-refusal-dialog/gate-refusal-dialog.component';
import type { GateRefusal } from '../gate-refusal';

/**
 * Tells the person once why the gateway did not let a request through. A page that loads refuses
 * a dozen reads at once; they all get one notice, not a dozen -- the next one opens only after it
 * was closed.
 */
@Injectable({
  providedIn: 'root'
})
export class GateRefusalNoticeService {
  private readonly dialog = inject(MatDialog);
  private open = false;

  show(refusal: GateRefusal): void {
    if (this.open) return;
    this.open = true;
    this.dialog
      .open(GateRefusalDialogComponent, { width: '420px', data: refusal })
      .afterClosed()
      .subscribe(() => {
        this.open = false;
      });
  }
}
