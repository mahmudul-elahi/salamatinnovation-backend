# Architecture & Technical Stack Rules

## Framework & Runtime
- **Framework**: NestJS v12+ configured as an ECMAScript Module (`"type": "module"`).
- **Import Rules**:
  - All local relative imports must end with `.js` extension (e.g., `import { AppModule } from './app.module.js'`).
  - Do not use CommonJS globals (`__dirname`, `__filename`, `require`). Use `import.meta.dirname` or `import.meta.url`.
- **Runtime**: Node.js 24+ / 26+.
- **Testing**: Vitest (`vitest`). Always use `vi.fn()`, `vi.spyOn()` instead of Jest globals. Unit specs go in `test/unit/` (never under `src/`); see Project Directory Structure.
- **Linting & Formatting**: Oxlint with `--type-aware` and Prettier.

## Project Directory Structure
- `src/common/`: Shared cross-cutting concerns:
  - `decorators/`: Custom decorators (`@CurrentUser()`, `@Public()`, `@Roles()`, `@RequirePermissions()`).
  - `filters/`: Global exception filters (`AllExceptionsFilter`).
  - `guards/`: Global and route security guards (`JwtAuthGuard`, `RolesGuard`, `PermissionsGuard`).
  - `interceptors/`: Request/response interceptors (`LoggingInterceptor`, `TransformInterceptor`).
  - `pagination/`: Standard `PaginationDto` and `createPaginatedResult` helpers.
- `src/config/`: `env.schema.ts` - Zod schema validating every environment variable; the only place defaults live. Inject `ConfigService<Env, true>` and read values with `config.get('KEY', { infer: true })`. Never read `process.env` in services.
- `src/database/`: Global database access via `PrismaModule` and `PrismaService`.
- `src/infrastructure/`: Low-level third-party infrastructure integrations:
  - `minio/`: S3-compatible object storage service for product images, documents, and attachments (`MinioService`, `MinioModule`).
  - `redis/`: `RedisService` (ioredis client with atomic helpers: `consume`, `increment`, `setIfAbsent`) and `RedisThrottlerStorage`. Use `CACHE_MANAGER` for plain read-through caching.
  - `mail/`: `MailService` enqueues email on the BullMQ `mail` queue; `MailProcessor` delivers it via `MailTransportService`. Templates live in `mail/templates/` and must escape user input.
- `src/modules/`: High-level domain and business feature modules (`auth/`, `users/`, `health/`, later `inventory/`, `sales/`).
  - Split large features into `controllers/`, `services/`, `dto/` (request DTOs and Swagger response DTOs), `strategies/`.
  - `users/UsersService` owns user lookups and the auth-user cache; call `invalidateAuthCache(userId)` after changing a user's status, role or permissions.
- `src/app.setup.ts`: HTTP pipeline (prefix, helmet, CORS, validation, Swagger) shared by `main.ts` and the e2e tests.
- Unit tests live in `test/unit/`, mirroring the `src/` tree (e.g. `src/modules/auth/services/token.service.ts` → `test/unit/modules/auth/services/token.service.spec.ts`); e2e tests (`*.e2e-spec.ts`) and shared helpers (`test/helpers/`) live in `test/`. Do not put spec files under `src/`.

## Persistence & Database
- **Database**: PostgreSQL with ACID transactional guarantees.
- **ORM**: Prisma ORM (`@prisma/client` + `prisma` + `@prisma/adapter-pg`).
- **Configuration**: `prisma.config.ts` and `prisma/schema/` (`schema.prisma` for generator/datasource, `enums.prisma` for all enums, one `<domain>.prisma` per domain).
- **Migrations**: every schema change ships with a migration (`npm run db:migrate`). Never use `prisma db push` against shared databases; CI fails if migrations and schema drift apart.
- **Database Access in NestJS**:
  - Global `PrismaModule` and `PrismaService` extending `PrismaClient` with lifecycle hooks (`onModuleInit`, `onModuleDestroy`).
  - Inject `PrismaService` into any service: `constructor(private readonly prisma: PrismaService) {}`.
- **Entity & Modeling Guidelines**:
  - Use `Decimal` (`@db.Decimal(15, 4)`) for monetary, pricing, and stock quantity fields.
  - Every model should include audit fields: `id` (UUID / CUID / autoincrement), `createdAt`, `updatedAt`.
  - Multi-tenant / Multi-branch fields (`companyId`, `branchId`) must be indexed.

## Database Seeding Policy (MANDATORY)
- **Every Table Must Have a Seeder**: Whenever a new Prisma model/table is created or modified, a corresponding seeder function and realistic seed data MUST be added.
- **Idempotency**: All seeders must be idempotent (using `upsert` or check-before-insert with unique keys like `slug`, `code`, `email`, `sku`). Running the seed script repeatedly must never fail or create duplicates.
- **Modular Seeder Structure**:
  - Main entry point: `prisma/seed.ts` (triggered with `npm run db:seed` or `npx prisma db seed`).
  - Domain seeders reside in `prisma/seeds/` (e.g. `roles.seed.ts`, `branches.seed.ts`, `users.seed.ts`, `categories.seed.ts`, `products.seed.ts`).
  - Execution order must strictly respect foreign key constraints (e.g., Companies/Branches -> Roles/Permissions -> Users -> Categories -> Products -> Stock -> Customers).
- **Realistic & Usable Seed Data**:
  - Seeders must provide real-world demo data: realistic SKUs, valid barcodes (EAN-13 / Code-128), decimal pricing, standard VAT/tax rates, and configured admin/cashier credentials for immediate local testing.

## Asynchronous Queues & Caching
- **Job Queues**: BullMQ (`@nestjs/bullmq` + `bullmq` + `ioredis`).
  - Heavy tasks (PDF invoice generation, Excel exports, bulk inventory recalculations, email delivery) must run through BullMQ worker queues rather than blocking synchronous HTTP request cycles.
- **Caching**: `@nestjs/cache-manager` with Redis.
  - Cache frequently queried read-only or low-mutation data (e.g. product catalogs, price lists, tax rules, branch configs).
- **Domain Events**: Use `@nestjs/event-emitter` to decouple domain side-effects (e.g., when a sale completes, emit `sale.completed` to trigger stock deduction and loyalty point updates).

## Infrastructure & Local Container Services
The application integrates with containerized external dependencies (PostgreSQL, Redis, MinIO).

### MinIO Object Storage Setup
MinIO provides high-performance, S3-compatible object storage for file uploads, invoices, barcodes, and attachments.

- **Ports**:
  - S3 API: `9000` (`http://localhost:9000`)
  - Web Console UI: `9001` (`http://localhost:9001`)
- **Credentials**:
  - Root User / Access Key: `minioadmin` (`MINIO_ACCESS_KEY`)
  - Root Password / Secret Key: `minioadmin` (`MINIO_SECRET_KEY`)
  - Bucket: `salamat-pos-erp` (`MINIO_BUCKET_NAME`, auto-created on application startup)

#### Launch Container via Docker
```bash
docker run -d \
  --name salamat-minio \
  --restart unless-stopped \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -v minio_data:/data \
  alpine/minio:latest-release server /data --console-address ":9001"
```

#### Docker Compose Reference
```yaml
services:
  minio:
    image: alpine/minio:latest-release
    container_name: salamat-minio
    restart: unless-stopped
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"

volumes:
  minio_data:
    driver: local
```
