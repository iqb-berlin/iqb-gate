import { TestBed } from '@angular/core/testing';
import { DEVTOOLS_PROBE_MS, GateInputActivityService } from './gate-input-activity.service';

describe('GateInputActivityService', () => {
  let service: GateInputActivityService;
  let listeners: Map<string, (event: Event) => void>;
  let addEventListenerSpy: jest.SpyInstance;
  let getContextSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;

  // A browser sets isTrusted for device input only, and jsdom does not let a test set it:
  // the listener the service registered is handed an event as the browser would
  const dispatch = (type: string, isTrusted: boolean): void => {
    listeners.get(type)?.({ type, isTrusted } as Event);
  };

  beforeEach(() => {
    listeners = new Map();
    addEventListenerSpy = jest.spyOn(document, 'addEventListener')
      .mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listener as (event: Event) => void);
      });
    getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    TestBed.configureTestingModule({});
    service = TestBed.inject(GateInputActivityService);
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    getContextSpy.mockRestore();
    debugSpy.mockRestore();
    jest.useRealTimers();
  });

  it('should listen to keyboard and pointer in the capture phase', () => {
    expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(addEventListenerSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
    expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
    expect(addEventListenerSpy).toHaveBeenCalledWith('change', expect.any(Function), true);
  });

  it('should report no input before there was any', () => {
    expect(service.signals().msSinceTrustedInput).toBeNull();
    expect(service.signals().untrustedInput).toBe(false);
  });

  it.each(['keydown', 'pointerdown'])('should take a trusted %s as a person\'s input', type => {
    jest.useFakeTimers({ now: 10_000 });
    dispatch(type, true);
    jest.setSystemTime(10_400);

    expect(service.signals().msSinceTrustedInput).toBe(400);
    expect(service.signals().untrustedInput).toBe(false);
  });

  it('should take input dispatched by a script as such', () => {
    dispatch('keydown', false);

    expect(service.signals().untrustedInput).toBe(true);
    expect(service.signals().msSinceTrustedInput).toBeNull();
  });

  // Screen readers in browse mode and voice control activate a button with a click alone; a file
  // picked in the system's file dialog arrives as a change, however long the choice took
  it.each(['click', 'change'])('should take a trusted %s as a person\'s input', type => {
    jest.useFakeTimers({ now: 10_000 });
    dispatch(type, true);
    jest.setSystemTime(10_100);

    expect(service.signals().msSinceTrustedInput).toBe(100);
  });

  // Applications click hidden file and colour inputs from its own code
  it.each(['click', 'change'])('should not hold a %s made by a script against anyone', type => {
    dispatch(type, false);

    expect(service.signals().untrustedInput).toBe(false);
    expect(service.signals().msSinceTrustedInput).toBeNull();
  });

  describe('the renderer', () => {
    let idle: Array<() => void>;
    let idleService: GateInputActivityService;

    beforeEach(() => {
      idle = [];
      const requestIdleCallback = jest.fn((callback: () => void) => idle.push(callback));
      Object.defineProperty(window, 'requestIdleCallback', { value: requestIdleCallback, configurable: true });
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      idleService = TestBed.inject(GateInputActivityService);
      getContextSpy.mockClear();
    });

    afterEach(() => {
      delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
    });

    it('should be looked at while the page is idle, and only then', () => {
      idle.forEach(callback => callback());
      idleService.signals();
      idleService.signals();

      expect(getContextSpy).toHaveBeenCalledTimes(1);
    });

    // The first reads of a page go out before it is idle; a WebGL context would hold each of them up
    it('should not be looked at on the way out of a request, and count as no until then', () => {
      const signals = idleService.signals();

      expect(getContextSpy).not.toHaveBeenCalled();
      expect(signals.softwareRenderer).toBe(false);
    });
  });

  it('should look at the renderer right after the start where the browser has no idle callback', () => {
    jest.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const startedService = TestBed.inject(GateInputActivityService);
    getContextSpy.mockClear();

    startedService.signals();
    expect(getContextSpy).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  // A page that loads sends a dozen reads: one probe line in the console, not a dozen
  it('should probe for the DevTools protocol at most once per period', () => {
    jest.useFakeTimers({ now: 0 });
    service.signals();
    service.signals();
    expect(debugSpy).toHaveBeenCalledTimes(1);

    jest.setSystemTime(DEVTOOLS_PROBE_MS);
    service.signals();

    expect(debugSpy).toHaveBeenCalledTimes(2);
  });

  it('should report what jsdom is: no webdriver, no headless browser', () => {
    const signals = service.signals();
    expect(signals.webdriver).toBe(false);
    expect(signals.headless).toBe(false);
    expect(signals.softwareRenderer).toBe(false);
  });
});
