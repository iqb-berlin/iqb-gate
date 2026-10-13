import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { GateRefusalDialogComponent } from './gate-refusal-dialog.component';
import { DEFAULT_GATE_TEXTS } from '../../gate-texts';
import { provideIqbGate } from '../../provide-iqb-gate';
import type { GateRefusal } from '../../gate-refusal';

describe('GateRefusalDialogComponent', () => {
  const render = (refusal: GateRefusal, texts = {}): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [GateRefusalDialogComponent],
      providers: [
        provideIqbGate({ texts }),
        { provide: MAT_DIALOG_DATA, useValue: refusal },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(GateRefusalDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const message = (element: HTMLElement) => element
    .querySelector('[data-cy="gate-refusal-message"]')?.textContent?.trim();

  it('should say that the browser is automated', () => {
    const element = render('automation-detected');

    expect(message(element)).toBe(DEFAULT_GATE_TEXTS.automationDetected);
    expect(element.textContent).toContain(DEFAULT_GATE_TEXTS.refusalTitle);
  });

  it('should say that the person was not confirmed', () => {
    expect(message(render('not-verified'))).toBe(DEFAULT_GATE_TEXTS.notVerified);
  });

  it('should take the application\'s texts', () => {
    const element = render('automation-detected', { automationDetected: 'Automatisiert.', close: 'OK' });

    expect(message(element)).toBe('Automatisiert.');
    expect(element.querySelector('[data-cy="gate-refusal-close"]')?.textContent?.trim()).toBe('OK');
  });
});
