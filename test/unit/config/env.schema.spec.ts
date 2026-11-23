import { describe, expect, it } from 'vitest';
import { validateEnv } from '../../../src/config/env.schema.js';

const base = {
  DATABASE_URL: 'postgresql://localhost/db',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults and coerces types', () => {
    const env = validateEnv({
      ...base,
      PORT: '4000',
      MINIO_USE_SSL: 'true',
      REDIS_PASSWORD: '',
    });

    expect(env.PORT).toBe(4000);
    expect(env.MINIO_USE_SSL).toBe(true);
    expect(env.REDIS_PASSWORD).toBeUndefined();
    expect(env.JWT_EXPIRES_IN).toBe('15m');
    expect(env.WEBAUTHN_ORIGIN).toEqual([
      'http://localhost:3000',
      'http://localhost:5173',
    ]);
  });

  it('requires DATABASE_URL and both JWT secrets', () => {
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*JWT_REFRESH_SECRET/,
    );
  });

  it('rejects short or identical JWT secrets', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'short' })).toThrow(
      /at least 32/,
    );
    expect(() =>
      validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_SECRET }),
    ).toThrow(/must differ/);
  });

  it('rejects malformed durations', () => {
    expect(() => validateEnv({ ...base, JWT_EXPIRES_IN: 'soon' })).toThrow(
      /duration/,
    );
  });

  it('rejects default MinIO credentials in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /MinIO/,
    );
  });
});
