import { PrismaClient, Role } from '@prisma/client';
import { hash } from '@node-rs/bcrypt';

export async function seedUsers(prisma: PrismaClient, adminRole: Role) {
  console.log('[SEED] Seeding users...');

  const defaultPassword = 'Admin@123456';
  const hashedPassword = await hash(defaultPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@salamatinnovation.com' },
    update: {
      firstName: 'Salamat',
      lastName: 'Admin',
      roleId: adminRole.id,
      isActive: true,
    },
    create: {
      email: 'admin@salamatinnovation.com',
      password: hashedPassword,
      firstName: 'Salamat',
      lastName: 'Admin',
      phone: '+8801700000000',
      roleId: adminRole.id,
      isActive: true,
    },
  });

  console.log(`[SEED] Admin user seeded: ${adminUser.email} (Role: ${adminRole.name})`);
  return adminUser;
}
