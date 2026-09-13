const MAX_FAILED_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const STORAGE_PREFIX = 'login-rate-limit:v1:'

type LoginAttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const getStorage = (): LoginAttemptStorage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const storageKey = (email: string) => {
  const normalizedEmail = email.trim().toLowerCase()
  let hash = 2166136261
  for (let index = 0; index < normalizedEmail.length; index += 1) {
    hash ^= normalizedEmail.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${STORAGE_PREFIX}${(hash >>> 0).toString(36)}`
}

const readRecentAttempts = (storage: LoginAttemptStorage, key: string, now: number) => {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter(
      (attempt): attempt is number =>
        typeof attempt === 'number' && Number.isFinite(attempt) && attempt > now - WINDOW_MS && attempt <= now,
    )
  } catch {
    return []
  }
}

const rateLimitError = (oldestAttempt: number, now: number) => {
  const minutes = Math.max(1, Math.ceil((oldestAttempt + WINDOW_MS - now) / 60_000))
  return new Error(`Too many login attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
}

export const withLoginRateLimit = async <Result>(
  email: string,
  attemptLogin: () => Promise<Result>,
  options: { now?: () => number; storage?: LoginAttemptStorage | null } = {},
): Promise<Result> => {
  const now = options.now ?? Date.now
  const storage = options.storage === undefined ? getStorage() : options.storage
  const key = storageKey(email)
  const startedAt = now()
  const recentAttempts = storage ? readRecentAttempts(storage, key, startedAt) : []

  if (recentAttempts.length >= MAX_FAILED_ATTEMPTS) {
    throw rateLimitError(recentAttempts[0], startedAt)
  }

  try {
    const result = await attemptLogin()
    try {
      storage?.removeItem(key)
    } catch {
      // A successful Firebase login must not fail because browser storage is unavailable.
    }
    return result
  } catch (error) {
    if (!storage) throw error

    const failedAt = now()
    const failures = [...readRecentAttempts(storage, key, failedAt), failedAt]
    try {
      storage.setItem(key, JSON.stringify(failures))
    } catch {
      throw error
    }

    if (failures.length >= MAX_FAILED_ATTEMPTS) {
      throw rateLimitError(failures[0], failedAt)
    }
    throw error
  }
}
