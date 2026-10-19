import { createMock } from '@golevelup/ts-jest';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { GateVerificationService } from './gate-verification.service';
import {
  GateVerificationDialogComponent
} from '../components/gate-verification-dialog/gate-verification-dialog.component';

jest.mock('altcha', () => ({}));

describe('GateVerificationService', () => {
  let service: GateVerificationService;
  let dialog: { open: jest.Mock };
  let closed: Subject<boolean | undefined>;

  beforeEach(() => {
    closed = new Subject<boolean | undefined>();
    dialog = {
      open: jest.fn(() => {
        const ref = createMock<MatDialogRef<GateVerificationDialogComponent>>();
        ref.afterClosed.mockReturnValue(closed);
        return ref;
      })
    };
    TestBed.configureTestingModule({
      providers: [{ provide: MatDialog, useValue: dialog }]
    });
    service = TestBed.inject(GateVerificationService);
  });

  afterEach(() => jest.useRealTimers());

  /** Closes the open dialog with the given result. */
  const close = (result: boolean): void => {
    closed.next(result);
    closed.complete();
  };

  it('should open the dialog so that only the dialog can close it', () => {
    service.verify().subscribe();

    expect(dialog.open).toHaveBeenCalledWith(
      GateVerificationDialogComponent,
      expect.objectContaining({ disableClose: true })
    );
  });

  it('should emit true once the challenge is solved', () => {
    const results: boolean[] = [];
    service.verify().subscribe(result => results.push(result));

    close(true);

    expect(results).toEqual([true]);
  });

  it('should emit false when the person cancels', () => {
    const results: boolean[] = [];
    service.verify().subscribe(result => results.push(result));

    close(false);

    expect(results).toEqual([false]);
  });

  // A save runs as several requests, and each of them may get a 428
  it('should let parallel requests wait for one dialog', () => {
    const results: boolean[] = [];
    service.verify().subscribe(result => results.push(result));
    service.verify().subscribe(result => results.push(result));

    close(true);

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(results).toEqual([true, true]);
  });

  // An upload sent beside the save that got the first 428 comes back with its own 428 afterwards
  it('should answer the 428 of a request sent before the solved challenge without asking again', () => {
    jest.useFakeTimers();
    const sent = performance.now();
    service.verify(sent).subscribe();
    jest.advanceTimersByTime(4000);
    close(true);

    const results: boolean[] = [];
    service.verify(sent).subscribe(result => results.push(result));

    expect(results).toEqual([true]);
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  // The gateway took the verification back: a save faster than a person, right after the challenge
  it('should ask again for a request sent after the solved challenge, however soon', () => {
    jest.useFakeTimers();
    service.verify(performance.now()).subscribe();
    jest.advanceTimersByTime(4000);
    close(true);

    closed = new Subject<boolean | undefined>();
    jest.advanceTimersByTime(1);
    service.verify(performance.now()).subscribe();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  // The gateway took the verification back, and a dialog is open: the session is not verified
  it('should let a request sent before the solved challenge wait for a dialog that is open again', () => {
    jest.useFakeTimers();
    const sentBefore = performance.now();
    service.verify(sentBefore).subscribe();
    jest.advanceTimersByTime(4000);
    close(true);

    closed = new Subject<boolean | undefined>();
    jest.advanceTimersByTime(1000);
    service.verify(performance.now()).subscribe();
    const results: boolean[] = [];
    service.verify(sentBefore).subscribe(result => results.push(result));
    expect(results).toEqual([]);

    close(false);
    expect(results).toEqual([false]);
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('should ask when it is not told when the request was sent', () => {
    service.verify().subscribe();
    close(true);

    closed = new Subject<boolean | undefined>();
    service.verify().subscribe();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('should not count a cancelled dialog as solved', () => {
    service.verify().subscribe();
    close(false);

    closed = new Subject<boolean | undefined>();
    service.verify().subscribe();

    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('should open a new dialog for the next request after the first one closed', () => {
    service.verify().subscribe();
    close(false);

    closed = new Subject<boolean | undefined>();
    service.verify().subscribe();

    expect(dialog.open).toHaveBeenCalledTimes(2);
  });
});
