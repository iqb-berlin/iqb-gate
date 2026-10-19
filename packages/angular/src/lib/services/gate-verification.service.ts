import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  finalize, map, type Observable, of, shareReplay, tap
} from 'rxjs';
import {
  GateVerificationDialogComponent
} from '../components/gate-verification-dialog/gate-verification-dialog.component';

/**
 * Opens the challenge dialog when the gateway wants proof that a person writes, and only one at a
 * time: a save that runs as several requests gets several 428 answers, and all of them wait for the
 * same dialog. Emits `true` once the session is verified, `false` when the person cancels.
 *
 * A request sent before the last solved challenge -- an upload running beside the save that got
 * the first 428 -- comes back with a 428 the challenge has answered already, and is repeated without
 * asking again. A 428 for a request sent afterwards is news: the gateway took the verification back
 * (writes faster than a person, observations a fresh challenge has to answer), and the dialog opens.
 * While a dialog is open, every 428 waits for it, whenever its request was sent: the session is not
 * verified until the person solves it.
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

  /**
   * `sentAt`: when the request the gateway answered with 428 was sent, by `performance.now()` -- a
   * clock that cannot be set back. Without it, the dialog opens.
   */
  verify(sentAt?: number): Observable<boolean> {
    if (this.pending) return this.pending;
    if (sentAt !== undefined && this.verifiedAt !== null && sentAt < this.verifiedAt) return of(true);
    this.pending = this.dialog
      .open(GateVerificationDialogComponent, { width: '420px', disableClose: true })
      .afterClosed()
      .pipe(
        map(result => result === true),
        tap(verified => {
          if (verified) this.verifiedAt = performance.now();
        }),
        finalize(() => {
          this.pending = null;
        }),
        shareReplay(1)
      );
    return this.pending;
  }
}
