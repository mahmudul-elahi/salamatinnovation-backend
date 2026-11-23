import type { RedisService } from '../../src/infrastructure/redis/redis.service.js';

/** In-memory stand-in for RedisService with TTL support, for unit tests. */
export class FakeRedis {
  private readonly store = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  private read(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async get(key: string) {
    return this.read(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = this.read(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set(key: string, value: string, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  async setJson(key: string, value: unknown, ttlMs: number) {
    await this.set(key, JSON.stringify(value), ttlMs);
  }

  async setIfAbsent(key: string, value: string, ttlMs: number) {
    if (this.read(key) !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async consume(key: string) {
    const value = this.read(key);
    this.store.delete(key);
    return value;
  }

  async increment(key: string, ttlMs: number) {
    const current = this.read(key);
    const next = (current === null ? 0 : Number(current)) + 1;
    const expiresAt =
      current === null ? Date.now() + ttlMs : this.store.get(key)!.expiresAt;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  async del(...keys: string[]) {
    keys.forEach((key) => this.store.delete(key));
  }

  async ping() {
    return true;
  }

  has(key: string) {
    return this.read(key) !== null;
  }

  asService(): RedisService {
    return this as unknown as RedisService;
  }
}
