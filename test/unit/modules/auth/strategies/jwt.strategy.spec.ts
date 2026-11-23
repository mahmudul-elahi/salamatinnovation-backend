import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../../../../../src/modules/auth/strategies/jwt.strategy.js';
import type { UsersService } from '../../../../../src/modules/users/users.service.js';

const authUser = {
  id: 'user-1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: null,
  role: { id: 'role-1', name: 'Store Manager', slug: 'manager' },
  permissions: ['users:read'],
  tokenVersion: 2,
  isActive: true,
};

function makeStrategy(getAuthUser = vi.fn().mockResolvedValue(authUser)) {
  const config = { get: vi.fn().mockReturnValue('s'.repeat(40)) };
  return new JwtStrategy(
    config as never,
    { getAuthUser } as unknown as UsersService,
  );
}

const payload = {
  sub: 'user-1',
  email: 'jane@example.com',
  role: 'manager',
  tv: 2,
  type: 'access' as const,
};

describe('JwtStrategy', () => {
  it('returns the authenticated user without internal fields', async () => {
    const user = await makeStrategy().validate(payload);
    expect(user).toEqual({
      id: 'user-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      role: authUser.role,
      permissions: ['users:read'],
    });
  });

  it('rejects tokens that are not access tokens', async () => {
    await expect(
      makeStrategy().validate({
        ...payload,
        type: 'refresh' as unknown as 'access',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects revoked tokens (tokenVersion mismatch)', async () => {
    await expect(
      makeStrategy().validate({ ...payload, tv: 1 }),
    ).rejects.toThrow(/revoked/);
  });

  it('rejects inactive or deleted users', async () => {
    await expect(
      makeStrategy(vi.fn().mockResolvedValue(null)).validate(payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
