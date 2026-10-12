import { ApplicationInitStatus, InjectionToken, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideIqbGate } from './provide-iqb-gate';
import { DEFAULT_GATE_TEXTS, IQB_GATE_TEXTS } from './gate-texts';
import { GateInputActivityService } from './services/gate-input-activity.service';

describe('provideIqbGate', () => {
  it('should watch the input from the start of the application', async () => {
    const created = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        provideIqbGate(),
        { provide: GateInputActivityService, useFactory: () => created() || {} }
      ]
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('should bring the library\'s texts without any of the application\'s', () => {
    TestBed.configureTestingModule({ providers: [provideIqbGate()] });
    expect(TestBed.inject(IQB_GATE_TEXTS)()).toEqual(DEFAULT_GATE_TEXTS);
  });

  it('should take texts given as they are', () => {
    TestBed.configureTestingModule({ providers: [provideIqbGate({ texts: { cancel: 'Cancel' } })] });
    expect(TestBed.inject(IQB_GATE_TEXTS)().cancel).toBe('Cancel');
  });

  it('should ask a function for the texts each time, in an injection context', () => {
    const LANGUAGE = new InjectionToken<{ current: string }>('LANGUAGE');
    const language = { current: 'Abbrechen' };
    TestBed.configureTestingModule({
      providers: [
        { provide: LANGUAGE, useValue: language },
        provideIqbGate({ texts: () => ({ cancel: inject(LANGUAGE).current }) })
      ]
    });
    const texts = TestBed.inject(IQB_GATE_TEXTS);
    expect(texts().cancel).toBe('Abbrechen');
    language.current = 'Cancel';
    expect(texts().cancel).toBe('Cancel');
  });
});
