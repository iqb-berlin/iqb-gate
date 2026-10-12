import { beforeEach, describe, expect, it } from 'vitest';
import { SessionVerificationState } from '../../src/write-gate/session-verification-state.js';

describe('SessionVerificationState', () => {
  const windowMs = 60_000;
  let state: SessionVerificationState;

  beforeEach(() => {
    state = new SessionVerificationState(3, windowMs);
  });

  it('should not count a session as verified before it solved a challenge', () => {
    expect(state.isVerified('sid')).toBe(false);
    expect(state.recordSave('sid', 0)).toBe(false);
  });

  it('should let a verified session save', () => {
    state.markVerified('sid', 0);

    expect(state.isVerified('sid')).toBe(true);
    expect(state.recordSave('sid', 1000)).toBe(true);
  });

  it('should keep sessions apart', () => {
    state.markVerified('sid-a', 0);

    expect(state.recordSave('sid-b', 1000)).toBe(false);
  });

  it('should take the verification back on the save past the limit within the window', () => {
    state.markVerified('sid', 0);
    expect(state.recordSave('sid', 1)).toBe(true);
    expect(state.recordSave('sid', 2)).toBe(true);
    expect(state.recordSave('sid', 3)).toBe(true);

    expect(state.recordSave('sid', 4)).toBe(false);
    expect(state.isVerified('sid')).toBe(false);
  });

  it('should let saves through that are spread over more than the window', () => {
    state.markVerified('sid', 0);
    [0, 25_000, 50_000, 75_000, 100_000, 125_000].forEach(time => {
      expect(state.recordSave('sid', time)).toBe(true);
    });
  });

  it('should start with an empty window once the challenge is solved again', () => {
    state.markVerified('sid', 0);
    [1, 2, 3, 4].forEach(time => state.recordSave('sid', time));

    state.markVerified('sid', 5);

    expect(state.recordSave('sid', 6)).toBe(true);
  });

  it('should tell when a session solved its challenge', () => {
    state.markVerified('sid', 1_000);

    expect(state.isVerifiedSince('sid', 1_000)).toBe(true);
    expect(state.isVerifiedSince('sid', 1_001)).toBe(false);
    expect(state.isVerifiedSince('other', 0)).toBe(false);
  });

  it('should take a verification back on request', () => {
    state.markVerified('sid', 0);

    state.revoke('sid');
    state.revoke('unknown');

    expect(state.isVerified('sid')).toBe(false);
    expect(state.isVerifiedSince('sid', 0)).toBe(false);
    expect(state.recordSave('sid', 1)).toBe(false);
  });

  it('should forget sessions not seen for longer than the given age', () => {
    state.markVerified('old', 0);
    state.markVerified('recent', 0);
    state.recordSave('recent', 9_000);

    state.prune(10_000, 5_000);

    expect(state.isVerified('old')).toBe(false);
    expect(state.isVerified('recent')).toBe(true);
    expect(state.size).toBe(1);
  });
});
