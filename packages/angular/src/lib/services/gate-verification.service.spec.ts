import { createMock } from '@golevelup/ts-jest';
import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { GateVerificationService, RECENTLY_VERIFIED_MS } from './gate-verification.service';
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
  it('should answer a 428 right after a solved challenge without asking again', () => {
    jest.useFakeTimers({ now: 0 });
    service.verify().subscribe();
    close(true);

    const results: boolean[] = [];
    jest.setSystemTime(RECENTLY_VERIFIED_MS - 1);
    service.verify().subscribe(result => results.push(result));

    expect(results).toEqual([true]);
    expect(dialog.open).toHaveBeenCalledTimes(1);

    closed = new Subject<boolean | undefined>();
    jest.setSystemTime(RECENTLY_VERIFIED_MS);
    service.verify().subscribe();
    expect(dialog.open).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
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
