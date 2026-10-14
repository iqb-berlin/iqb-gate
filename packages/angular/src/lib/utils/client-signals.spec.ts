import {
  collectClientSignals, detectDevtoolsProtocol, detectSoftwareRenderer, ObservedInput
} from './client-signals';

describe('client signals', () => {
  const windowMs = 60_000;
  const now = 1_000_000;
  const plainBrowser = { webdriver: false, userAgent: 'Mozilla/5.0 Chrome/141.0' };
  const environment = { softwareRenderer: false, devtoolsProtocol: false };
  const input = (changes: Partial<ObservedInput> = {}): ObservedInput => ({
    lastTrustedInputAt: now - 500, lastUntrustedInputAt: null, ...changes
  });

  describe('collectClientSignals', () => {
    it('should report a person who clicked a moment ago', () => {
      expect(collectClientSignals(plainBrowser, input(), environment, now, windowMs)).toEqual({
        webdriver: false,
        headless: false,
        untrustedInput: false,
        msSinceTrustedInput: 500,
        softwareRenderer: false,
        devtoolsProtocol: false
      });
    });

    it('should report a browser driven by WebDriver, Playwright, Puppeteer or Cypress', () => {
      expect(collectClientSignals({ ...plainBrowser, webdriver: true }, input(), environment, now, windowMs).webdriver)
        .toBe(true);
    });

    it('should report a headless browser', () => {
      const headless = { userAgent: 'Mozilla/5.0 HeadlessChrome/141.0' };
      expect(collectClientSignals(headless, input(), environment, now, windowMs).headless).toBe(true);
    });

    it('should report no trusted input as null', () => {
      const noInput = input({ lastTrustedInputAt: null });
      const signals = collectClientSignals(plainBrowser, noInput, environment, now, windowMs);
      expect(signals.msSinceTrustedInput).toBeNull();
    });

    it('should report script-dispatched input only within the window', () => {
      const recent = input({ lastUntrustedInputAt: now - windowMs });
      const old = input({ lastUntrustedInputAt: now - windowMs - 1 });
      expect(collectClientSignals(plainBrowser, recent, environment, now, windowMs).untrustedInput).toBe(true);
      expect(collectClientSignals(plainBrowser, old, environment, now, windowMs).untrustedInput).toBe(false);
    });

    it('should pass on what the environment showed', () => {
      const signals = collectClientSignals(
        plainBrowser, input(), { softwareRenderer: true, devtoolsProtocol: true }, now, windowMs
      );
      expect(signals.softwareRenderer).toBe(true);
      expect(signals.devtoolsProtocol).toBe(true);
    });
  });

  describe('detectSoftwareRenderer', () => {
    const canvasWith = (renderer: string | null) => () => ({
      getContext: () => (renderer === null ? null : {
        RENDERER: 7937,
        getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 37446 }),
        getParameter: () => renderer
      })
    });

    it('should recognise software renderers', () => {
      expect(detectSoftwareRenderer(canvasWith('Google SwiftShader'))).toBe(true);
      expect(detectSoftwareRenderer(canvasWith('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe(true);
    });

    it('should not report a graphics card', () => {
      expect(detectSoftwareRenderer(canvasWith('ANGLE (Intel, Mesa Intel(R) UHD Graphics 620)'))).toBe(false);
    });

    it('should not report anything without WebGL', () => {
      expect(detectSoftwareRenderer(canvasWith(null))).toBe(false);
      expect(detectSoftwareRenderer(() => { throw new Error('no canvas'); })).toBe(false);
    });
  });

  describe('detectDevtoolsProtocol', () => {
    it('should report a console that serialises what it is handed', () => {
      const serialising = { debug: (value: Error) => value.stack };
      expect(detectDevtoolsProtocol(serialising)).toBe(true);
    });

    it('should not report a console nobody is attached to', () => {
      expect(detectDevtoolsProtocol({ debug: () => undefined })).toBe(false);
    });

    it('should not report a console that fails', () => {
      expect(detectDevtoolsProtocol({ debug: () => { throw new Error('blocked'); } })).toBe(false);
    });
  });
});
