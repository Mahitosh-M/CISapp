import { describe, expect, it, vi } from 'vitest'
import { withLoginRateLimit } from './loginRateLimit'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
  corruptAll() { this.values.forEach((_value, key) => this.values.set(key, 'broken')) }
}

describe('withLoginRateLimit', () => {
  it('blocks after five failed attempts for the same email', async () => {
    const storage = new MemoryStorage()
    const attempt = vi.fn().mockRejectedValue(new Error('Incorrect password'))
    const options = { now: () => 1_000_000, storage }

    for (let count = 0; count < 4; count += 1) {
      await expect(withLoginRateLimit('USER@example.com', attempt, options)).rejects.toThrow('Incorrect password')
    }
    await expect(withLoginRateLimit('user@example.com', attempt, options)).rejects.toThrow('Too many login attempts')
    await expect(withLoginRateLimit('user@example.com', attempt, options)).rejects.toThrow('Try again in 15 minutes')
    expect(attempt).toHaveBeenCalledTimes(5)
  })

  it('allows another attempt after the rolling window expires', async () => {
    const storage = new MemoryStorage()
    let currentTime = 1_000_000
    const failure = vi.fn().mockRejectedValue(new Error('Incorrect password'))
    const options = { now: () => currentTime, storage }

    for (let count = 0; count < 5; count += 1) {
      await expect(withLoginRateLimit('user@example.com', failure, options)).rejects.toThrow()
    }
    currentTime += 15 * 60 * 1000 + 1
    const success = vi.fn().mockResolvedValue('signed-in')
    await expect(withLoginRateLimit('user@example.com', success, options)).resolves.toBe('signed-in')
  })

  it('clears failed attempts after a successful login', async () => {
    const storage = new MemoryStorage()
    const options = { now: () => 1_000_000, storage }
    for (let count = 0; count < 4; count += 1) {
      await expect(withLoginRateLimit('user@example.com', () => Promise.reject(new Error('No')), options)).rejects.toThrow('No')
    }
    await withLoginRateLimit('user@example.com', () => Promise.resolve('yes'), options)
    await expect(withLoginRateLimit('user@example.com', () => Promise.reject(new Error('No')), options)).rejects.toThrow('No')
  })

  it('recovers from malformed stored data', async () => {
    const storage = new MemoryStorage()
    await expect(
      withLoginRateLimit('user@example.com', () => Promise.reject(new Error('No')), { now: () => 1_000_000, storage }),
    ).rejects.toThrow('No')
    storage.corruptAll()
    await expect(
      withLoginRateLimit('user@example.com', () => Promise.resolve('yes'), { now: () => 1_000_000, storage }),
    ).resolves.toBe('yes')
  })
})
