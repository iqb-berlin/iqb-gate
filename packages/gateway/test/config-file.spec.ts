import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readConfigFile } from '../src/config-file.js';
import { parseConfig } from '../src/config.js';

const ENV = { IQB_GATE_UPSTREAM: 'http://app:8080', IQB_GATE_SECRET: 'x'.repeat(32) };

function configFile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'iqb-gate-')), 'gate.yaml');
  writeFileSync(path, content);
  return path;
}

describe('readConfigFile', () => {
  it('reads nothing without IQB_GATE_CONFIG', () => {
    expect(readConfigFile(ENV)).toBeUndefined();
  });

  it('reads the file IQB_GATE_CONFIG names', () => {
    const path = configFile('writeGate:\n  rules:\n    - { name: workspace, path: "^/api/workspaces/" }\n');
    expect(readConfigFile({ ...ENV, IQB_GATE_CONFIG: path })).toContain('name: workspace');
  });

  it('lets rules from the file be switched off by name, as the health check needs', () => {
    const path = configFile('writeGate:\n  rules:\n    - { name: workspace, path: "^/api/workspaces/" }\n');
    const env = { ...ENV, IQB_GATE_CONFIG: path, IQB_GATE_RULES_OFF: 'workspace' };
    expect(() => parseConfig(env)).toThrow(/workspace/);
    expect(parseConfig(env, readConfigFile(env)).writeGate.rules[0].off).toBe(true);
  });
});
