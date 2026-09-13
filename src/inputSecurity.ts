// Validate raw user payloads before normalization or network writes. React escapes plain text.
// Reject invalid input rather than silently stripping characters from names, notes or passwords.
export function assertUserInput(input: unknown): void {
  let nodes = 0;
  let bytes = 0;
  const seen = new Set<object>();
  const visit = (value: unknown, key: string, depth: number): void => {
    if (++nodes > 10000 || depth > 8) throw new Error('Input is too large or deeply nested.');
    if (value === undefined || value === null || typeof value === 'boolean') { bytes += 5; return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new Error('Invalid numeric input.');
      bytes += 24;
      return;
    }
    if (typeof value === 'string') {
      const max = key === 'token' ? 16384 : 4000;
      if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('Text is oversized or contains invalid control characters.');
      bytes += new TextEncoder().encode(value).length;
      if (bytes > 262144) throw new Error('Input exceeds 256 KB.');
      if (/^(id|uid)$|Id$/.test(key) && value && (value.length > 180 || value.includes('/') || value === '.' || value === '..')) throw new Error('Invalid record identifier.');
      if (/url$/i.test(key) && value) {
        if (/^\/(?!\/)/.test(value)) return;
        let url: URL;
        try { url = new URL(value); } catch { throw new Error('Invalid URL.'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported URL.');
      }
      if (/Date$/.test(key) && value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Use a valid date in YYYY-MM-DD format.');
        const date = new Date(value + 'T00:00:00Z');
        if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.');
      }
      return;
    }
    if (typeof value !== 'object' || seen.has(value)) throw new Error('Invalid input structure.');
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 500) throw new Error('Too many entries (maximum 500).');
      value.forEach(item => visit(item, '', depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('Expected a plain input object.');
      const entries = Object.entries(value);
      if (entries.length > 100) throw new Error('Too many input fields.');
      for (const [field, child] of entries) {
        if (['__proto__', 'prototype', 'constructor'].includes(field) || field.length > 100) throw new Error('Unsupported input field.');
        bytes += field.length * 3;
        visit(child, field, depth + 1);
      }
    }
    seen.delete(value);
  };
  visit(input, '', 0);
  if (bytes > 262144) throw new Error('Input exceeds 256 KB.');
}

export function assertLoginInput(email: unknown, password: unknown): void {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address (maximum 254 characters).');
  if (typeof password !== 'string' || password.length === 0 || password.length > 4096) throw new Error('Enter a password of 1 to 4096 characters.');
  // Never normalize or trim passwords: that would change the user's credentials.
}
