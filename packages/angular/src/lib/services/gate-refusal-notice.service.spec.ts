import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Subject } from 'rxjs';
import { GateRefusalNoticeService } from './gate-refusal-notice.service';
import { GateRefusalDialogComponent } from '../components/gate-refusal-dialog/gate-refusal-dialog.component';

describe('GateRefusalNoticeService', () => {
  let service: GateRefusalNoticeService;
  let dialog: { open: jest.Mock };
  let closed: Subject<unknown>;

  beforeEach(() => {
    closed = new Subject<unknown>();
    dialog = {
      open: jest.fn(() => ({ afterClosed: () => closed }) as unknown as MatDialogRef<GateRefusalDialogComponent>)
    };
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: dialog }] });
    service = TestBed.inject(GateRefusalNoticeService);
  });

  it('should open the notice with the reason', () => {
    service.show('automation-detected');

    expect(dialog.open).toHaveBeenCalledWith(
      GateRefusalDialogComponent,
      expect.objectContaining({ data: 'automation-detected' })
    );
  });

  // A page that loads gets a dozen refusals at once
  it('should open one notice for refusals that come while it is open', () => {
    service.show('automation-detected');
    service.show('automation-detected');
    service.show('not-verified');

    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('should open the next notice once the first was closed', () => {
    service.show('automation-detected');
    closed.next(true);
    closed.complete();
    closed = new Subject<unknown>();

    service.show('not-verified');

    expect(dialog.open).toHaveBeenCalledTimes(2);
  });
});
