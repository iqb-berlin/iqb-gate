import { createMock } from '@golevelup/ts-jest';
import {
  type EnvironmentProviders, type Provider, provideZonelessChangeDetection
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { GateVerificationDialogComponent } from './gate-verification-dialog.component';
import { GateChallengeService } from '../../services/gate-challenge.service';
import { DEFAULT_GATE_TEXTS } from '../../gate-texts';

/** Whether loading the widget fails, as after a deployment that removed its old chunk. */
let mockWidgetUnavailable = false;
jest.mock('altcha', () => {
  if (mockWidgetUnavailable) throw new Error('ChunkLoadError');
  return {};
});

describe('GateVerificationDialogComponent, loading the widget', () => {
  const challenge = { parameters: { algorithm: 'PBKDF2/SHA-256' }, signature: 'sig' };

  /** The dialog, drawn by hand -- or, without zone.js, only by what Angular schedules itself. */
  const createDialog = async (providers: Array<Provider | EnvironmentProviders> = [], zoneless = false) => {
    globalThis.$altcha = createMock<typeof globalThis.$altcha>({ i18n: { set: jest.fn() } });
    await TestBed.configureTestingModule({
      imports: [GateVerificationDialogComponent],
      providers: [
        ...providers,
        { provide: GateChallengeService, useValue: { challenge: () => of(challenge), verify: () => of(true) } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    }).compileComponents();
    const fixture = TestBed.createComponent(GateVerificationDialogComponent);
    if (zoneless) {
      fixture.autoDetectChanges();
      // The widget loads outside of what Angular waits for; its signal schedules the view after it
      await new Promise(resolve => { setTimeout(resolve); });
      await fixture.whenStable();
      return fixture;
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  afterEach(() => {
    mockWidgetUnavailable = false;
  });

  it('should load the widget again when the person tries again', async () => {
    mockWidgetUnavailable = true;
    const fixture = await createDialog();
    expect(fixture.componentInstance.loadFailed()).toBe(true);
    expect(fixture.nativeElement.querySelector('altcha-widget')).toBeNull();

    mockWidgetUnavailable = false;
    fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.loadFailed()).toBe(false);
    expect(fixture.nativeElement.querySelector('altcha-widget')).not.toBeNull();
  });

  // A browser that keeps a failed module fetch rejects every further import at once: only a reload helps
  it('should say that a reload may be needed once the widget fails to load again', async () => {
    // An earlier test loaded the widget: forget it, so that loading it fails again
    jest.resetModules();
    mockWidgetUnavailable = true;
    const fixture = await createDialog();
    expect(fixture.nativeElement.textContent).not.toContain(DEFAULT_GATE_TEXTS.reloadNeeded);

    fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]').click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.loadFailed()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(DEFAULT_GATE_TEXTS.reloadNeeded);
    expect(fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]')).not.toBeNull();
  });

  // Angular 21 creates applications without zone.js
  it('should show the widget in an application without zone.js', async () => {
    const fixture = await createDialog([provideZonelessChangeDetection()], true);
    expect(fixture.nativeElement.querySelector('altcha-widget')).not.toBeNull();
  });
});
