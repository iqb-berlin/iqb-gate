import { describe, expect, it } from 'vitest';
import { isAuditAuthorized } from '../../src/audit/audit-access.js';

const KEY = 'audit-key-audit-key-audit-key-123';
const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString('base64')}`;

describe('isAuditAuthorized', () => {
  it('lets in the key as Bearer token', () => {
    expect(isAuditAuthorized(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(isAuditAuthorized(`bearer ${KEY}`, KEY)).toBe(true);
  });

  it('lets in the key as password, whatever the user name', () => {
    expect(isAuditAuthorized(basic(`admin:${KEY}`), KEY)).toBe(true);
    expect(isAuditAuthorized(basic(`:${KEY}`), KEY)).toBe(true);
  });

  it('keeps out everything else', () => {
    expect(isAuditAuthorized(undefined, KEY)).toBe(false);
    expect(isAuditAuthorized('', KEY)).toBe(false);
    expect(isAuditAuthorized('Bearer wrong', KEY)).toBe(false);
    expect(isAuditAuthorized(basic(`${KEY}:x`), KEY)).toBe(false);
    expect(isAuditAuthorized(basic(KEY), KEY)).toBe(false);
    expect(isAuditAuthorized(`Token ${KEY}`, KEY)).toBe(false);
    expect(isAuditAuthorized(`Bearer ${KEY}x`, KEY)).toBe(false);
  });
});
