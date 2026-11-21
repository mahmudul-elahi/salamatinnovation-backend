import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedRolesAndPermissions } from './seeds/roles.seed.js';
import { seedUsers } from './seeds/users.seed.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[SEED] DATABASE_URL is not set.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  console.log('[SEED] Starting database seeding...');

  // Order respects foreign keys: roles/permissions -> users.
  const roles = await seedRolesAndPermissions(prisma);
  await seedUsers(prisma, roles);

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
