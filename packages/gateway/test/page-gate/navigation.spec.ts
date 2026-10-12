import { describe, expect, it } from 'vitest';
import { isNavigation } from '../../src/page-gate/navigation.js';

describe('isNavigation', () => {
  it('takes what the browser says about opening a page', () => {
    expect(isNavigation('GET', { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).toBe(true);
    expect(isNavigation('GET', { 'sec-fetch-mode': 'navigate' })).toBe(true);
  });

  it('leaves the page\'s own fetches, assets and frames alone', () => {
    const fetchOfThePage = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', accept: 'text/html' };
    expect(isNavigation('GET', fetchOfThePage)).toBe(false);
    expect(isNavigation('GET', { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' })).toBe(false);
    expect(isNavigation('GET', { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' })).toBe(false);
  });

  it('asks the Accept header when the browser says nothing', () => {
    expect(isNavigation('GET', { accept: 'text/html,application/xhtml+xml;q=0.9' })).toBe(true);
    expect(isNavigation('HEAD', { accept: 'text/html' })).toBe(true);
    expect(isNavigation('GET', { accept: 'application/json' })).toBe(false);
    expect(isNavigation('GET', {})).toBe(false);
  });

  it('never takes a write for a navigation', () => {
    expect(isNavigation('POST', { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })).toBe(false);
  });
});
