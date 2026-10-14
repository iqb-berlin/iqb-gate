import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_TEXTS, parsePageTexts } from '../../src/page-gate/page-texts.js';

describe('parsePageTexts', () => {
  it('keeps the German defaults without texts of the installation', () => {
    expect(parsePageTexts(undefined)).toEqual(DEFAULT_PAGE_TEXTS);
    expect(parsePageTexts({})).toEqual(DEFAULT_PAGE_TEXTS);
  });

  it('replaces the texts it is given, and keeps the others', () => {
    expect(parsePageTexts({ title: 'One moment …', denied: 'Not allowed.' }))
      .toEqual({ ...DEFAULT_PAGE_TEXTS, title: 'One moment …', denied: 'Not allowed.' });
  });

  // A misspelt name would otherwise leave the German text in place without a word
  it('refuses a text it does not know, and one that is no text', () => {
    expect(() => parsePageTexts({ titel: 'x' })).toThrow(/pageGate.texts has unknown keys: titel/);
    expect(() => parsePageTexts({ title: '  ' })).toThrow('pageGate.texts.title has to be a text.');
    expect(() => parsePageTexts({ title: 3 })).toThrow('pageGate.texts.title has to be a text.');
    expect(() => parsePageTexts('Weiter')).toThrow(/has to be a mapping/);
  });
});
