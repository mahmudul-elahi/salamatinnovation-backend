# Salamat Innovation POS & ERP - Backend

NestJS 12 (ESM) REST API for the Salamat point-of-sale and ERP platform.

Stack: PostgreSQL (Prisma 7), Redis (cache, BullMQ queues, rate limiting, auth state), MinIO (S3-compatible storage), JWT + passkey (WebAuthn) authentication.

## Getting started

Requirements: Node.js 24+, and Docker (or local installs of PostgreSQL, Redis and MinIO).

```bash
npm install
cp .env.example .env          # then set JWT_SECRET and JWT_REFRESH_SECRET
docker compose up -d          # PostgreSQL, Redis, MinIO
npm run db:deploy             # apply migrations
npm run db:seed               # roles, permissions, demo users
npm run start:dev
```

- API: http://localhost:3000/api
- Swagger docs: http://localhost:3000/api/docs (disabled in production unless `SWAGGER_ENABLED=true`)
- Health: http://localhost:3000/api/health and `/api/health/storage`

Demo accounts created by the seed:

| Email | Password | Role |
| --- | --- | --- |
| admin@salamatinnovation.com | Admin@123456 | Administrator (all permissions) |
| manager@salamatinnovation.com | Manager@123456 | Store Manager |

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run start:dev` | Run with watch mode |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run it |
| `npm run typecheck` | Type-check source and tests |
| `npm run lint` / `npm run format` | Oxlint (type-aware) / Prettier |
| `npm test` | Unit tests in `test/unit/` (Vitest, no external services needed) |
| `npm run test:e2e` | End-to-end tests in `test/*.e2e-spec.ts` (needs Postgres, Redis, MinIO and a seeded DB) |
| `npm run db:migrate` | Create and apply a new migration in development |
| `npm run db:deploy` | Apply pending migrations (CI / production) |
| `npm run db:seed` | Idempotent seed |
| `npm run db:studio` | Prisma Studio |

## Project layout

```
src/
  main.ts                 bootstrap
  app.setup.ts            HTTP pipeline shared by main.ts and e2e tests (prefix, helmet, CORS, validation, Swagger)
  app.module.ts           root module, global guards / filter / interceptors
  config/env.schema.ts    Zod schema for every environment variable (the only place defaults live)
  common/                 decorators, guards, filters, interceptors, pagination
  database/               PrismaService (global)
  infrastructure/
    redis/                RedisService (ioredis) and Redis-backed rate-limit storage
    mail/                 MailService (enqueue), BullMQ MailProcessor, SMTP transport, templates
    minio/                MinioService
  modules/
    auth/                 controllers (auth, password, passkey), services (auth, token, password, passkey), JWT strategy
    users/                UsersService: user lookups, auth-user cache, password/token-version updates
    health/               Terminus health checks
prisma/                   schema, migrations, seeders
test/
  unit/                   unit specs, mirroring the src/ tree
  helpers/                shared fakes and fixtures
  *.e2e-spec.ts           e2e specs
```

## Authentication model

- **Access token**: short-lived JWT (`JWT_EXPIRES_IN`, default 15m), signed with `JWT_SECRET`.
- **Refresh token**: JWT signed with a separate `JWT_REFRESH_SECRET`, tracked in Redis by `jti`. Each refresh consumes it and returns a new pair (rotation); reuse is rejected. `POST /api/auth/logout` revokes it.
- **Revocation**: every token carries the user's `tokenVersion`. Password reset, password change and `POST /api/auth/logout-all` bump it, which invalidates all earlier tokens.
- **Authorization**: `JwtAuthGuard`, `RolesGuard` and `PermissionsGuard` are global. Use `@Public()`, `@Roles('manager')` and `@RequirePermissions('users:read')` on routes. The `admin` role passes every permission check.
- **Rate limiting**: 100 requests/min per IP by default, 5/min on login and password-reset endpoints, stored in Redis. Set `TRUST_PROXY=true` behind a reverse proxy.
- **Password reset**: 6-digit OTP (hashed in Redis, 10 min, 5 attempts, 60 s resend cooldown) -> single-use reset token (15 min).

## Response format

Successful responses are wrapped by `TransformInterceptor`:

```json
{ "success": true, "statusCode": 200, "data": { ... }, "timestamp": "..." }
```

Errors are produced by `AllExceptionsFilter`:

```json
{ "success": false, "statusCode": 400, "message": "...", "path": "/api/...", "timestamp": "..." }
```

Use `@BypassTransform()` for endpoints that must return a raw body (health checks, file streams).
