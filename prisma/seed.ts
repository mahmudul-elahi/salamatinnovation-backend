import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedRolesAndPermissions } from './seeds/roles.seed.js';
import { seedUsers } from './seeds/users.seed.js';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:@localhost:5432/pos_erp_dev?schema=public';

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('[SEED] Starting database seeding...');

  // 1. Roles and Permissions
  const { adminRole } = await seedRolesAndPermissions(prisma);

  // 2. Default Users
  await seedUsers(prisma, adminRole);

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
