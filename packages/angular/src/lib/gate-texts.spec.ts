import { DEFAULT_GATE_TEXTS, mergeGateTexts } from './gate-texts';

describe('mergeGateTexts', () => {
  it('should keep the library\'s texts where the application gives none', () => {
    expect(mergeGateTexts()).toEqual(DEFAULT_GATE_TEXTS);
  });

  it('should take the application\'s texts, the widget\'s one by one', () => {
    const texts = mergeGateTexts({ cancel: 'Cancel', widget: { label: 'I am human' } });
    expect(texts.cancel).toBe('Cancel');
    expect(texts.title).toBe(DEFAULT_GATE_TEXTS.title);
    expect(texts.widget.label).toBe('I am human');
    expect(texts.widget.verify).toBe(DEFAULT_GATE_TEXTS.widget.verify);
  });

  // A translation that is missing comes back as undefined
  it('should keep the library\'s text where the application\'s is undefined', () => {
    const texts = mergeGateTexts({ title: undefined, widget: { label: undefined, verify: 'Check' } });
    expect(texts.title).toBe(DEFAULT_GATE_TEXTS.title);
    expect(texts.widget.label).toBe(DEFAULT_GATE_TEXTS.widget.label);
    expect(texts.widget.verify).toBe('Check');
  });
});
