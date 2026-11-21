import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env.schema.js';

// Lua scripts keep these operations atomic on any Redis >= 2.6.
const CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value then redis.call('DEL', KEYS[1]) end
return value`;

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count`;

/**
 * Direct Redis access for state that needs atomic operations (OTP attempt
 * counters, one-time tokens, WebAuthn challenges, rate limiting).
 *
 * For plain read-through caching of query results prefer `CACHE_MANAGER`
 * from `@nestjs/cache-manager`.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis({
      host: config.get('REDIS_HOST', { infer: true }),
      port: config.get('REDIS_PORT', { infer: true }),
      password: config.get('REDIS_PASSWORD', { infer: true }),
      keyPrefix: 'app:',
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
    this.client.on('error', (err) =>
      this.logger.error(`[REDIS] Connection error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.client.set(key, value, 'PX', ttlMs);
  }

  async setJson(key: string, value: unknown, ttlMs: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlMs);
  }

  /** Sets the key only if it does not exist. Returns true when it was set. */
  async setIfAbsent(
    key: string,
    value: string,
    ttlMs: number,
  ): Promise<boolean> {
    const result = await this.client.set(key, value, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /** Atomically reads and deletes a key (single-use tokens, challenges). */
  async consume(key: string): Promise<string | null> {
    return (await this.client.eval(CONSUME_SCRIPT, 1, key)) as string | null;
  }

  /** Atomically increments a counter, starting its TTL on first increment. */
  async increment(key: string, ttlMs: number): Promise<number> {
    return (await this.client.eval(INCREMENT_SCRIPT, 1, key, ttlMs)) as number;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
