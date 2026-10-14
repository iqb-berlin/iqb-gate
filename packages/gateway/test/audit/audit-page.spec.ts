import { describe, expect, it } from 'vitest';
import { AUDIT_PAGE } from '../../src/audit/audit-page.js';

const inlineScript = (): string => /<script>([\s\S]*?)<\/script>/.exec(AUDIT_PAGE)?.[1] ?? '';

describe('AUDIT_PAGE', () => {
  it('puts its texts into the page', () => {
    expect(AUDIT_PAGE).toContain('<title>iqb-gate · Zugriffe</title>');
    expect(AUDIT_PAGE).toContain('<h1>Zugriffe</h1>');
    expect(AUDIT_PAGE).toContain('<th>Zeit</th><th>Nutzer</th>');
    expect(AUDIT_PAGE).toContain('<button type="submit">Anzeigen</button>');
  });

  it('hands its script the texts it shows, as data', () => {
    const [, json] = /const TEXTS = (\{.*\});/.exec(inlineScript()) ?? [];
    expect(JSON.parse(json)).toEqual(expect.objectContaining({
      outcomes: expect.objectContaining({ 'automation-detected': 'Automatisierung erkannt' }),
      loading: 'Lade …'
    }));
  });

  // A slip in the template would only show in an administrator's browser
  it('has a script that compiles', () => {
    expect(() => new Function(inlineScript())).not.toThrow();
  });
});
