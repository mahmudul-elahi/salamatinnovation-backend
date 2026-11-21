import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service.js';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

// Returns { totalHits, ttlMs, isBlocked (0/1), blockTtlMs } atomically.
const INCREMENT_SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  return { limit + 1, redis.call('PTTL', hitsKey), 1, blockTtl }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then redis.call('PEXPIRE', hitsKey, ttl) end
local hitsTtl = redis.call('PTTL', hitsKey)

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { hits, hitsTtl, 1, blockDuration }
end

return { hits, hitsTtl, 0, 0 }`;

/**
 * Rate-limit counters shared across every app instance, so limits hold when
 * the API is scaled horizontally or restarted.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [totalHits, ttlMs, isBlocked, blockTtlMs] =
      (await this.redis.client.eval(
        INCREMENT_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [number, number, number, number];

    return {
      totalHits,
      // The throttler guard expects seconds.
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: isBlocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtlMs / 1000)),
    };
  }
}
