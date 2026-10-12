import type { ClientSignals } from '@iqb/gate-protocol';

/** What the page has seen of its keyboard and pointer input (see `GateInputActivityService`). */
export interface ObservedInput {
  /** When the last keyboard or pointer event came from a device; `null` if none has yet. */
  lastTrustedInputAt: number | null;
  /** When the last keyboard or pointer event came from a script; `null` if none has. */
  lastUntrustedInputAt: number | null;
}

/** The part of `navigator` read here. */
export interface NavigatorLike {
  webdriver?: boolean;
  userAgent: string;
}

/** Names of software renderers -- headless browsers, but also virtual machines and remote desktops. */
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software/i;

/**
 * Puts together what the browser observed about itself and its input for one write. The gateway
 * decides what of it rejects the write.
 *
 * A script-dispatched event counts only within `windowMs`: one that an application library may
 * dispatch now and then must not lock a person out for the rest of the session.
 */
export function collectClientSignals(
  navigatorLike: NavigatorLike,
  input: ObservedInput,
  environment: { softwareRenderer: boolean; devtoolsProtocol: boolean },
  now: number,
  windowMs: number
): ClientSignals {
  return {
    webdriver: navigatorLike.webdriver === true,
    headless: /HeadlessChrome/.test(navigatorLike.userAgent),
    untrustedInput: input.lastUntrustedInputAt !== null && now - input.lastUntrustedInputAt <= windowMs,
    msSinceTrustedInput: input.lastTrustedInputAt === null ? null : Math.max(0, now - input.lastTrustedInputAt),
    softwareRenderer: environment.softwareRenderer,
    devtoolsProtocol: environment.devtoolsProtocol
  };
}

/** Whether WebGL draws in software. `false` where WebGL or the renderer name is not available. */
export function detectSoftwareRenderer(createCanvas: () => HTMLCanvasElement): boolean {
  try {
    const gl = createCanvas().getContext('webgl');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof renderer === 'string' && SOFTWARE_RENDERERS.test(renderer);
  } catch {
    return false;
  }
}

/**
 * Whether the page is attached to the DevTools protocol, as automation tools attach it: only then is
 * an object handed to the console serialised, which reads its `stack`. An open DevTools window does
 * the same, which is why the gateway only records this observation.
 */
export function detectDevtoolsProtocol(consoleLike: Pick<Console, 'debug'>): boolean {
  let serialised = false;
  const probe = new Error();
  Object.defineProperty(probe, 'stack', {
    configurable: true,
    get: () => {
      serialised = true;
      return '';
    }
  });
  try {
    consoleLike.debug(probe);
  } catch {
    return false;
  }
  return serialised;
}
