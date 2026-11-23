import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/bcrypt';

interface UserSeed {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  roleId: string;
}

/**
 * Idempotent: creates the demo accounts if missing. Existing accounts keep
 * their current password, so re-seeding never resets a changed password.
 */
export async function seedUsers(
  prisma: PrismaClient,
  roles: { adminRole: { id: string }; managerRole: { id: string } },
) {
  console.log('[SEED] Seeding users...');

  const users: UserSeed[] = [
    {
      email: 'admin@salamatinnovation.com',
      password: 'Admin@123456',
      firstName: 'Salamat',
      lastName: 'Admin',
      phone: '+8801700000000',
      roleId: roles.adminRole.id,
    },
    {
      email: 'manager@salamatinnovation.com',
      password: 'Manager@123456',
      firstName: 'Store',
      lastName: 'Manager',
      phone: '+8801700000001',
      roleId: roles.managerRole.id,
    },
  ];

  for (const { password, ...user } of users) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        firstName: user.firstName,
        lastName: user.lastName,
        roleId: user.roleId,
      },
      create: { ...user, password: await hash(password), isActive: true },
    });
    console.log(`[SEED] User seeded: ${record.email}`);
  }
}
