import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:@localhost:5432/pos_erp_dev?schema=public';

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('[SEED] Starting database seeding...');

  // Modular seeders will be called here in relational dependency order:
  // e.g.:
  // await seedRolesAndPermissions(prisma);
  // await seedBranches(prisma);
  // await seedUsers(prisma);
  // await seedCategories(prisma);
  // await seedProducts(prisma);

  console.log('[SEED] Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('[SEED] Database seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
