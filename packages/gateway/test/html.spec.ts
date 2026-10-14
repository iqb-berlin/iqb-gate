import { describe, expect, it } from 'vitest';
import { escapeHtml, jsonForScriptBlock } from '../src/html.js';

describe('escapeHtml', () => {
  it('escapes what could start markup or end an attribute', () => {
    expect(escapeHtml(`<b class="x">Tom & Jerry's</b>`))
      .toBe('&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
  });

  it('leaves plain text as it is', () => {
    expect(escapeHtml('Einen Moment bitte …')).toBe('Einen Moment bitte …');
  });
});

describe('jsonForScriptBlock', () => {
  it('cannot end its script block early, and reads back as the value it was', () => {
    const value = { text: '</script><script>alert(1)</script><!-- & \u2028' };
    const json = jsonForScriptBlock(value);
    expect(json).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(json)).toEqual(value);
  });
});
