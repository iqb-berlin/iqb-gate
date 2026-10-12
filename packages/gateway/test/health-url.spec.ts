import { describe, expect, it } from 'vitest';
import { healthUrl } from '../src/health-url.js';

describe('healthUrl', () => {
  it('asks the loopback when the gateway listens on every interface', () => {
    expect(healthUrl('0.0.0.0', 8080)).toBe('http://127.0.0.1:8080/.iqb-gate/health');
    expect(healthUrl('::', 8080)).toBe('http://127.0.0.1:8080/.iqb-gate/health');
  });

  it('follows a configured port', () => {
    expect(healthUrl('0.0.0.0', 3000)).toBe('http://127.0.0.1:3000/.iqb-gate/health');
  });

  it('asks the one address the gateway listens on', () => {
    expect(healthUrl('10.0.0.5', 8080)).toBe('http://10.0.0.5:8080/.iqb-gate/health');
    expect(healthUrl('fd00::5', 8080)).toBe('http://[fd00::5]:8080/.iqb-gate/health');
  });
});
