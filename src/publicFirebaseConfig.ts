// Only public Firebase browser options belong here. Never supply server credentials.
export function readFirebaseConfig(raw: unknown, name: string) {
  const runtime = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } };
  const value = raw ?? runtime.process?.env?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing public Firebase configuration: ${name}`);
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(`Invalid JSON in ${name}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`Invalid configuration in ${name}`);
  const options = parsed as Record<string, unknown>;
  const allowed = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error(`${name} contains unsupported fields; use only public Firebase web options`);
  for (const key of allowed) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !String(options[key]).trim())) throw new Error(`Invalid ${key} in ${name}`);
  }
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId']) {
    if (!options[key]) throw new Error(`Missing ${key} in ${name}`);
  }
  return options as { apiKey: string; authDomain: string; projectId: string; appId: string; storageBucket?: string; messagingSenderId?: string };
}
