import { z } from 'zod';
import { ConfigService } from '@nestjs/config';

/** Treats `FOO=` (empty string) the same as an unset variable. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const csvList = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );

/** Durations accepted by jsonwebtoken, e.g. `900`, `15m`, `12h`, `7d`. */
const duration = (fallback: string) =>
  z
    .string()
    .regex(
      /^\d+\s*(ms|s|m|h|d|w|y)?$/i,
      'must be a duration such as 15m, 12h or 7d',
    )
    .default(fallback);

const port = (fallback: number) =>
  z.coerce.number().int().min(1).max(65535).default(fallback);

/**
 * Single source of truth for every environment variable the app reads.
 * Defaults live here and nowhere else; services read typed values through
 * `AppConfigService`.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: port(3000),
    TRUST_PROXY: z.stringbool().default(false),
    CORS_ORIGINS: csvList('http://localhost:3000,http://localhost:5173'),
    SWAGGER_ENABLED: z.stringbool().optional(),

    DATABASE_URL: z.string().min(1),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: port(6379),
    REDIS_PASSWORD: optionalString,
    CACHE_TTL: z.coerce.number().int().positive().default(300_000),

    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN: duration('15m'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_REFRESH_EXPIRES_IN: duration('7d'),

    SMTP_HOST: optionalString,
    SMTP_PORT: port(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    SMTP_FROM: z
      .string()
      .default('"Salamat POS & ERP" <no-reply@salamatinnovation.com>'),

    MINIO_ENDPOINT: z.string().default('localhost'),
    MINIO_PORT: port(9000),
    MINIO_USE_SSL: z.stringbool().default(false),
    MINIO_REGION: optionalString,
    MINIO_ACCESS_KEY: z.string().default('minioadmin'),
    MINIO_SECRET_KEY: z.string().default('minioadmin'),
    MINIO_BUCKET_NAME: z.string().default('salamat-pos-erp'),

    WEBAUTHN_RP_NAME: z.string().default('Salamat POS & ERP'),
    WEBAUTHN_RP_ID: z.string().default('localhost'),
    WEBAUTHN_ORIGIN: csvList('http://localhost:3000,http://localhost:5173'),
  })
  .refine((env) => env.JWT_SECRET !== env.JWT_REFRESH_SECRET, {
    message: 'JWT_REFRESH_SECRET must differ from JWT_SECRET',
    path: ['JWT_REFRESH_SECRET'],
  })
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' ||
      (env.MINIO_ACCESS_KEY !== 'minioadmin' &&
        env.MINIO_SECRET_KEY !== 'minioadmin'),
    {
      message: 'Default MinIO credentials are not allowed in production',
      path: ['MINIO_SECRET_KEY'],
    },
  );

export type Env = z.infer<typeof envSchema>;

/** `ConfigService` typed against `Env`; use `get('KEY', { infer: true })`. */
export type AppConfigService = ConfigService<Env, true>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
      )
      .join('\n');
    throw new Error(`[CONFIG] Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
