import { describe, expect, it } from 'vitest';
import { assertLoginInput, assertUserInput } from './inputSecurity';
import { readFirebaseConfig } from './publicFirebaseConfig';

describe('user input validation', () => {
  it('preserves normal multilingual text and punctuation', () => {
    const input = { name: "O'Brien & Sons à²•à²¨à³à²¨à²¡", notes: 'Call tomorrow\nAfter 10 AM', amount: 2000, dueDate: '2026-09-15' };
    expect(() => assertUserInput(input)).not.toThrow();
    expect(input.notes).toBe('Call tomorrow\nAfter 10 AM');
  });
  it('rejects oversized text, arrays, bodies and deeply nested input', () => {
    expect(() => assertUserInput({ notes: 'x'.repeat(4001) })).toThrow();
    expect(() => assertUserInput(Array(501).fill(1))).toThrow();
    expect(() => assertUserInput(Array(100).fill('x'.repeat(4000)))).toThrow();
    let nested: unknown = 1;
    for (let i = 0; i < 10; i++) nested = { child: nested };
    expect(() => assertUserInput(nested)).toThrow();
  });
  it('rejects non-finite numbers, cycles and prototype keys', () => {
    for (const amount of [NaN, Infinity, -Infinity, 1e13]) expect(() => assertUserInput({ amount })).toThrow();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => assertUserInput(cyclic)).toThrow();
    expect(() => assertUserInput(JSON.parse('{"__proto__":{"admin":true}}'))).toThrow();
  });
  it('rejects invalid dates, control characters, IDs and executable URLs', () => {
    for (const data of [{ dueDate: '2026-02-30' }, { id: '../users' }, { notes: '\u0000' }, { imageUrl: 'javascript:alert(1)' }, { imageUrl: 'https://user:pass@example.com' }]) expect(() => assertUserInput(data)).toThrow();
    expect(() => assertUserInput({ imageUrl: '/images/logo.svg', dueDate: '2028-02-29' })).not.toThrow();
  });
  it('validates credentials without modifying passwords', () => {
    expect(() => assertLoginInput(' staff@example.com ', ' exact password ')).not.toThrow();
    expect(() => assertLoginInput('bad-email', 'password')).toThrow();
    expect(() => assertLoginInput('staff@example.com', 'x'.repeat(4097))).toThrow();
    expect(() => assertLoginInput({}, 'password')).toThrow();
  });
});

describe('public environment configuration', () => {
  const options = { apiKey: 'public-test-key', authDomain: 'demo.example.com', projectId: 'demo-project', appId: 'demo-app' };
  it('accepts only expected public Firebase fields', () => {
    expect(readFirebaseConfig(JSON.stringify(options), 'TEST_CONFIG')).toEqual(options);
    expect(() => readFirebaseConfig(JSON.stringify({ ...options, private_key: 'do-not-publish' }), 'TEST_CONFIG')).toThrow();
  });
  it('rejects empty, malformed or incomplete configuration without echoing values', () => {
    for (const raw of ['', 'secret-invalid-json', '[]', '{}', '{"apiKey":123}']) {
      expect(() => readFirebaseConfig(raw, 'TEST_CONFIG')).toThrow();
      try { readFirebaseConfig(raw, 'TEST_CONFIG'); } catch (error) { expect((error as Error).message).not.toContain('secret-invalid-json'); }
    }
  });
});
