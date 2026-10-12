import { describe, expect, it } from 'vitest';
import { issuePass, passHolds } from '../../src/page-gate/page-pass.js';

const KEY = 'page-pass-key';
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 12);

describe('the page pass', () => {
  const pass = issuePass(KEY, BROWSER, NOW, 7);

  it('holds for the browser it was issued to, for its days', () => {
    expect(passHolds(pass, KEY, BROWSER, NOW)).toBe(true);
    expect(passHolds(pass, KEY, BROWSER, NOW + 7 * DAY_MS - 1000)).toBe(true);
  });

  it('expires', () => {
    expect(passHolds(pass, KEY, BROWSER, NOW + 7 * DAY_MS)).toBe(false);
  });

  it('holds for no other browser', () => {
    expect(passHolds(pass, KEY, 'python-requests/2.32', NOW)).toBe(false);
  });

  it('holds only as the gateway signed it', () => {
    const [expiresAt, browser, signature] = pass.split('.');
    expect(passHolds(`${Number(expiresAt) + 86400}.${browser}.${signature}`, KEY, BROWSER, NOW)).toBe(false);
    expect(passHolds(pass, 'other-key', BROWSER, NOW)).toBe(false);
    expect(passHolds(`${expiresAt}.${browser}.x`, KEY, BROWSER, NOW)).toBe(false);
    expect(passHolds('garbage', KEY, BROWSER, NOW)).toBe(false);
    expect(passHolds(undefined, KEY, BROWSER, NOW)).toBe(false);
  });
});
