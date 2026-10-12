import { beforeEach, describe, expect, it } from 'vitest';
import { RepeatedRejections } from '../../src/audit/repeated-rejections.js';

describe('RepeatedRejections', () => {
  let rejections: RepeatedRejections;

  beforeEach(() => {
    rejections = new RepeatedRejections(60_000);
  });

  it('has the first rejection of a kind written', () => {
    expect(rejections.isRepeat('a', 0)).toBe(false);
  });

  it('counts the repeats within the window instead of writing them', () => {
    rejections.opened('a', 7, 0);
    expect(rejections.isRepeat('a', 1_000)).toBe(true);
    expect(rejections.isRepeat('a', 59_999)).toBe(true);
    expect(rejections.drain(60_000)).toEqual([{ id: 7, count: 2 }]);
  });

  it('counts each repeat once', () => {
    rejections.opened('a', 7, 0);
    rejections.isRepeat('a', 1_000);
    expect(rejections.drain(2_000)).toEqual([{ id: 7, count: 1 }]);
    rejections.isRepeat('a', 3_000);
    expect(rejections.drain(4_000)).toEqual([{ id: 7, count: 1 }]);
    expect(rejections.drain(5_000)).toEqual([]);
  });

  it('keeps different kinds apart', () => {
    rejections.opened('a', 1, 0);
    rejections.opened('b', 2, 100);
    rejections.isRepeat('a', 200);
    rejections.isRepeat('b', 300);
    rejections.isRepeat('b', 400);
    expect(rejections.drain(500)).toEqual([{ id: 1, count: 1 }, { id: 2, count: 2 }]);
  });

  it('has a rejection written again once the window is over', () => {
    rejections.opened('a', 1, 0);
    expect(rejections.isRepeat('a', 30_000)).toBe(true);
    expect(rejections.isRepeat('a', 60_000)).toBe(false);
  });

  it('keeps the repeats of a window that a newer one of its kind replaced', () => {
    rejections.opened('a', 1, 0);
    rejections.isRepeat('a', 10);
    rejections.opened('a', 2, 61_000);
    rejections.isRepeat('a', 61_010);
    expect(rejections.drain(62_000)).toEqual([{ id: 1, count: 1 }, { id: 2, count: 1 }]);
  });

  it('forgets a window once it is over and drained', () => {
    rejections.opened('a', 1, 0);
    rejections.drain(60_001);
    expect(rejections.isRepeat('a', 60_002)).toBe(false);
  });

  // A failed insert opens no window: the next rejection is written instead of being counted for nothing
  it('has the next rejection written when the first one could not be', () => {
    expect(rejections.isRepeat('a', 0)).toBe(false);
    expect(rejections.isRepeat('a', 10)).toBe(false);
  });
});
