import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const val = await this.cacheManager.get<T>(key);
      return val ?? null;
    } catch (err: any) {
      this.logger.error(`[REDIS] Error getting key "${key}": ${err.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttlMs?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttlMs);
    } catch (err: any) {
      this.logger.error(`[REDIS] Error setting key "${key}": ${err.message}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
    } catch (err: any) {
      this.logger.error(`[REDIS] Error deleting key "${key}": ${err.message}`);
    }
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null && val !== undefined;
  }

  async ping(): Promise<boolean> {
    try {
      await this.cacheManager.set('__health_ping__', 'pong', 5000);
      const val = await this.cacheManager.get<string>('__health_ping__');
      return val === 'pong';
    } catch {
      return false;
    }
  }
}
