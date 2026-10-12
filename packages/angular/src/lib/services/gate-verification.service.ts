import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  finalize, map, type Observable, of, shareReplay, tap
} from 'rxjs';
import {
  GateVerificationDialogComponent
} from '../components/gate-verification-dialog/gate-verification-dialog.component';

/**
 * How long a solved challenge answers a 428 without asking again: a write sent before the session
 * was verified -- an upload running beside the save that got the first 428 -- comes back with its
 * own 428 after the dialog closed, and is repeated once instead of asking the person a second time.
 */
export const RECENTLY_VERIFIED_MS = 30 * 1000;

/**
 * Opens the challenge dialog when the gateway wants proof that a person writes, and only one at a
 * time: a save that runs as several requests gets several 428 answers, and all of them wait for the
 * same dialog. Emits `true` once the session is verified, `false` when the person cancels.
 *
 * The dialog is part of the library's bundle -- it is small, and the applications load Material's
 * dialog anyway. What is loaded only when a challenge is due is the ALTCHA widget in it.
 */
@Injectable({
  providedIn: 'root'
})
export class GateVerificationService {
  private readonly dialog = inject(MatDialog);
  private pending: Observable<boolean> | null = null;
  private verifiedAt: number | null = null;

  verify(): Observable<boolean> {
    if (this.verifiedAt !== null && Date.now() - this.verifiedAt < RECENTLY_VERIFIED_MS) return of(true);
    if (!this.pending) {
      this.pending = this.dialog
        .open(GateVerificationDialogComponent, { width: '420px', disableClose: true })
        .afterClosed()
        .pipe(
          map(result => result === true),
          tap(verified => {
            if (verified) this.verifiedAt = Date.now();
          }),
          finalize(() => {
            this.pending = null;
          }),
          shareReplay(1)
        );
    }
    return this.pending;
  }
}
