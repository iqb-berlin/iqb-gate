import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { GateVerificationDialogComponent, WIDGET_LANGUAGE } from './gate-verification-dialog.component';
import { GateChallengeService } from '../../services/gate-challenge.service';
import { IQB_GATE_TEXTS, mergeGateTexts, WIDGET_TEXT_NAMES } from '../../gate-texts';

jest.mock('altcha', () => ({}));

describe('GateVerificationDialogComponent', () => {
  let component: GateVerificationDialogComponent;
  let fixture: ComponentFixture<GateVerificationDialogComponent>;
  let challengeService: { challenge: jest.Mock; verify: jest.Mock };
  let dialogRef: { close: jest.Mock };
  let i18nSet: jest.Mock;
  const challenge = { parameters: { algorithm: 'PBKDF2/SHA-256' }, signature: 'sig' };
  const texts = mergeGateTexts({ title: 'Prove it', widget: { label: 'I am a person' } });

  const verifiedEvent = (payload?: string): Event => new CustomEvent('verified', { detail: { payload } });

  beforeEach(async () => {
    challengeService = {
      challenge: jest.fn(() => of(challenge)),
      verify: jest.fn(() => of(true))
    };
    dialogRef = { close: jest.fn() };
    i18nSet = jest.fn();
    // What loading 'altcha' provides in the browser
    globalThis.$altcha = { i18n: { set: i18nSet } } as unknown as typeof globalThis.$altcha;

    await TestBed.configureTestingModule({
      imports: [GateVerificationDialogComponent],
      providers: [
        { provide: GateChallengeService, useValue: challengeService },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: IQB_GATE_TEXTS, useValue: () => texts }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(GateVerificationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The widget is loaded with the dialog
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should show the application\'s texts', () => {
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Prove it');
    expect(fixture.nativeElement.textContent).toContain(texts.intro);
  });

  it('should hand the widget its texts, under a language of its own', () => {
    const [language, widgetTexts] = i18nSet.mock.calls[0];
    expect(language).toBe(WIDGET_LANGUAGE);
    expect(Object.keys(widgetTexts)).toEqual([...WIDGET_TEXT_NAMES]);
    expect(widgetTexts.label).toBe('I am a person');
    expect(widgetTexts.verify).toBe('Überprüfen');
  });

  it('should hand the widget the challenge as JSON', () => {
    const widget = fixture.debugElement.query(By.css('altcha-widget')).nativeElement as HTMLElement;
    expect(JSON.parse(widget.getAttribute('challenge') as string)).toEqual(challenge);
    expect(widget.getAttribute('language')).toBe(WIDGET_LANGUAGE);
  });

  it('should close with true once the gateway accepts the solution', () => {
    fixture.debugElement.query(By.css('altcha-widget')).triggerEventHandler('verified', verifiedEvent('payload'));

    expect(challengeService.verify).toHaveBeenCalledWith('payload');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('should say so and fetch a new challenge when the gateway rejects the solution', () => {
    challengeService.verify.mockReturnValue(of(false));

    component.onVerified(verifiedEvent('payload'));
    fixture.detectChanges();

    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.failed()).toBe(true);
    expect(challengeService.challenge).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('.gate-verification-failed')).not.toBeNull();
  });

  it('should ignore an event without a payload', () => {
    component.onVerified(verifiedEvent());

    expect(challengeService.verify).not.toHaveBeenCalled();
  });

  it('should say so when no challenge can be fetched, and offer to fetch it again', () => {
    challengeService.challenge.mockReturnValue(of(null));

    component.load();
    fixture.detectChanges();

    expect(component.challenge()).toBeNull();
    expect(component.loadFailed()).toBe(true);
    expect(component.failed()).toBe(false);
    expect(fixture.debugElement.query(By.css('altcha-widget'))).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]')).not.toBeNull();
  });

  it('should show the widget once fetching again succeeds', () => {
    challengeService.challenge.mockReturnValue(of(null));
    component.load();
    fixture.detectChanges();
    challengeService.challenge.mockReturnValue(of(challenge));

    fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]').click();
    fixture.detectChanges();

    expect(component.loadFailed()).toBe(false);
    expect(fixture.debugElement.query(By.css('altcha-widget'))).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-cy="human-verification-retry"]')).toBeNull();
  });

  it('should close with false when cancelled', () => {
    fixture.nativeElement.querySelector('[data-cy="human-verification-cancel"]').click();

    expect(dialogRef.close).toHaveBeenCalledWith(false);
  });
});
