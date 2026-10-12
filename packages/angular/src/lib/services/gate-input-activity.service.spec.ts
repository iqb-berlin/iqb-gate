import { TestBed } from '@angular/core/testing';
import { GateInputActivityService } from './gate-input-activity.service';

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

  it('should look at the renderer while the page is idle, before the first write', () => {
    const idle: Array<() => void> = [];
    const requestIdleCallback = jest.fn((callback: () => void) => idle.push(callback));
    Object.defineProperty(window, 'requestIdleCallback', { value: requestIdleCallback, configurable: true });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const idleService = TestBed.inject(GateInputActivityService);
    getContextSpy.mockClear();

    idle.forEach(callback => callback());
    idleService.signals();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback;
  });

  it('should look at the renderer only once', () => {
    service.signals();
    service.signals();

    expect(getContextSpy).toHaveBeenCalledTimes(1);
  });

  it('should report what jsdom is: no webdriver, no headless browser', () => {
    const signals = service.signals();
    expect(signals.webdriver).toBe(false);
    expect(signals.headless).toBe(false);
    expect(signals.softwareRenderer).toBe(false);
  });
});
