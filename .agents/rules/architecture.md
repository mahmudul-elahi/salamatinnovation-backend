# Architecture & Technical Stack Rules

## Framework & Runtime
- **Framework**: NestJS v12+ configured as an ECMAScript Module (`"type": "module"`).
- **Import Rules**:
  - All local relative imports must end with `.js` extension (e.g., `import { AppModule } from './app.module.js'`).
  - Do not use CommonJS globals (`__dirname`, `__filename`, `require`). Use `import.meta.dirname` or `import.meta.url`.
- **Runtime**: Node.js 24+ / 26+.
- **Testing**: Vitest (`vitest`). Always use `vi.fn()`, `vi.spyOn()` instead of Jest globals.
- **Linting & Formatting**: Oxlint with `--type-aware` and Prettier.

## Project Directory Structure
- `src/common/`: Shared cross-cutting concerns:
  - `decorators/`: Custom decorators (`@CurrentUser()`, `@Public()`, `@Roles()`, `@RequirePermissions()`).
  - `filters/`: Global exception filters (`AllExceptionsFilter`).
  - `guards/`: Global and route security guards (`JwtAuthGuard`, `RolesGuard`, `PermissionsGuard`).
  - `interceptors/`: Request/response interceptors (`LoggingInterceptor`, `TransformInterceptor`).
  - `pagination/`: Standard `PaginationDto` and `createPaginatedResult` helpers.
- `src/config/`: Unified configuration loader (`configuration.ts`) and environment validation (`validation.ts`).
- `src/database/`: Global database access via `PrismaModule` and `PrismaService`.
- `src/infrastructure/`: Low-level third-party infrastructure integrations:
  - `minio/`: S3-compatible object storage service for product images, documents, and attachments (`MinioService`, `MinioModule`).
  - `redis/`: Redis key-value operations and cache helpers (`RedisService`, `RedisModule`).
- `src/modules/`: High-level domain and business feature modules (`auth/`, `mail/`, `users/`, `inventory/`, `sales/`).

## Persistence & Database
- **Database**: PostgreSQL with ACID transactional guarantees.
- **ORM**: Prisma ORM (`@prisma/client` + `prisma` + `@prisma/adapter-pg`).
- **Configuration**: `prisma.config.ts` and `prisma/schema.prisma`.
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
