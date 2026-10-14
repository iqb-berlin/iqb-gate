import { describe, expect, it } from 'vitest';
import {
  ConfigError, firstDuplicate, parseSwitch, positiveIntegerAt
} from '../src/config-helpers.js';

describe('parseSwitch', () => {
  it('reads on and off, in any case and with spaces around, and falls back when not given', () => {
    expect(parseSwitch(' On ', 'X', 'off')).toBe(true);
    expect(parseSwitch('OFF', 'X', 'on')).toBe(false);
    expect(parseSwitch(undefined, 'X', 'on')).toBe(true);
    expect(parseSwitch('', 'X', 'off')).toBe(false);
  });

  it('refuses anything else, naming the setting', () => {
    expect(() => parseSwitch('yes', 'IQB_GATE_SOMETHING', 'off')).toThrow(ConfigError);
    expect(() => parseSwitch('yes', 'IQB_GATE_SOMETHING', 'off')).toThrow('IQB_GATE_SOMETHING is on or off, not yes.');
  });
});

describe('firstDuplicate', () => {
  it('finds the first entry whose key came before', () => {
    const rules = [{ name: 'a', n: 1 }, { name: 'b', n: 2 }, { name: 'a', n: 3 }, { name: 'b', n: 4 }];
    expect(firstDuplicate(rules, rule => rule.name)).toEqual({ name: 'a', n: 3 });
  });

  it('finds nothing in a list without repeats', () => {
    expect(firstDuplicate([{ prefix: '/a' }, { prefix: '/b' }], path => path.prefix)).toBeUndefined();
    expect(firstDuplicate([], (entry: string) => entry)).toBeUndefined();
  });
});

describe('positiveIntegerAt', () => {
  it('takes a positive whole number, and the fallback where there is none', () => {
    expect(positiveIntegerAt(5, 7, 'x')).toBe(5);
    expect(positiveIntegerAt(undefined, 7, 'x')).toBe(7);
  });

  it('refuses anything else, naming the setting', () => {
    [0, -1, 1.5, '5'].forEach(value => {
      expect(() => positiveIntegerAt(value, 7, 'pageGate.passDays')).toThrow(ConfigError);
      expect(() => positiveIntegerAt(value, 7, 'pageGate.passDays')).toThrow(/pageGate.passDays/);
    });
  });
});
