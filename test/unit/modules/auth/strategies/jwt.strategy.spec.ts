import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../../../../../src/modules/auth/strategies/jwt.strategy.js';
import type { SessionService } from '../../../../../src/modules/auth/services/session.service.js';
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

function makeStrategy(
  getAuthUser = vi.fn().mockResolvedValue(authUser),
  isActive = vi.fn().mockResolvedValue(true),
) {
  const config = { get: vi.fn().mockReturnValue('s'.repeat(40)) };
  return new JwtStrategy(
    config as never,
    { getAuthUser } as unknown as UsersService,
    { isActive } as unknown as SessionService,
  );
}

const payload = {
  sub: 'user-1',
  email: 'jane@example.com',
  role: 'manager',
  tv: 2,
  sid: 'session-1',
  type: 'access' as const,
};

describe('JwtStrategy', () => {
  it('returns the user and session without internal fields', async () => {
    const user = await makeStrategy().validate(payload);
    expect(user).toEqual({
      id: 'user-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      role: authUser.role,
      permissions: ['users:read'],
      sessionId: 'session-1',
    });
  });

  it('rejects tokens whose session was signed out', async () => {
    const isActive = vi.fn().mockResolvedValue(false);
    await expect(
      makeStrategy(undefined, isActive).validate(payload),
    ).rejects.toThrow(/signed out/);
    expect(isActive).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('rejects tokens issued before sessions existed (no sid)', async () => {
    const { sid: _sid, ...legacy } = payload;
    await expect(
      makeStrategy().validate(legacy as typeof payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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
