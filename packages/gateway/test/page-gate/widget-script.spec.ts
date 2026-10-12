import { describe, expect, it } from 'vitest';
import { loadWidgetScript, versioned } from '../../src/page-gate/widget-script.js';

describe('the widget script', () => {
  it('is the classic bundle of the widget, with its translations', () => {
    const { content } = loadWidgetScript();
    expect(content).toContain('customElements.define');
    expect(content).toContain('Überprüfung fehlgeschlagen');
    expect(content).not.toMatch(/^\s*export\s/m);
  });

  it('carries a version that changes with its content', () => {
    expect(versioned('a').version).toMatch(/^[0-9a-f]{12}$/);
    expect(versioned('a').version).toBe(versioned('a').version);
    expect(versioned('a').version).not.toBe(versioned('b').version);
  });
});
