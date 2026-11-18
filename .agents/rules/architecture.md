# Architecture & Technical Stack Rules

## Framework & Runtime
- **Framework**: NestJS v12+ configured as an ECMAScript Module (`"type": "module"`).
- **Import Rules**:
  - All local relative imports must end with `.js` extension (e.g., `import { AppModule } from './app.module.js'`).
  - Do not use CommonJS globals (`__dirname`, `__filename`, `require`). Use `import.meta.dirname` or `import.meta.url`.
- **Runtime**: Node.js 24+ / 26+.
- **Testing**: Vitest (`vitest`). Always use `vi.fn()`, `vi.spyOn()` instead of Jest globals.
- **Linting & Formatting**: Oxlint with `--type-aware` and Prettier.

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

## Asynchronous Queues & Caching
- **Job Queues**: BullMQ (`@nestjs/bullmq` + `bullmq` + `ioredis`).
  - Heavy tasks (PDF invoice generation, Excel exports, bulk inventory recalculations, email delivery) must run through BullMQ worker queues rather than blocking synchronous HTTP request cycles.
- **Caching**: `@nestjs/cache-manager` with Redis.
  - Cache frequently queried read-only or low-mutation data (e.g. product catalogs, price lists, tax rules, branch configs).
- **Domain Events**: Use `@nestjs/event-emitter` to decouple domain side-effects (e.g., when a sale completes, emit `sale.completed` to trigger stock deduction and loyalty point updates).
