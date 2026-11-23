import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { FakeRedis } from '../../../../helpers/fake-redis.js';
import { makeUser } from '../../../../helpers/fixtures.js';
import { TokenService } from '../../../../../src/modules/auth/services/token.service.js';
import type { UsersService } from '../../../../../src/modules/users/users.service.js';

const ACCESS_SECRET = 'a'.repeat(40);
const REFRESH_SECRET = 'r'.repeat(40);

describe('TokenService', () => {
  let redis: FakeRedis;
  let jwt: JwtService;
  let users: { getAuthUser: ReturnType<typeof vi.fn> };
  let service: TokenService;
  const user = makeUser();

  beforeEach(() => {
    redis = new FakeRedis();
    jwt = new JwtService({
      secret: ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    });
    users = {
      getAuthUser: vi.fn().mockResolvedValue({ ...user, tokenVersion: 0 }),
    };
    const config = {
      get: vi.fn(
        (key: string) =>
          ({
            JWT_REFRESH_SECRET: REFRESH_SECRET,
            JWT_REFRESH_EXPIRES_IN: '7d',
          })[key],
      ),
    };
    service = new TokenService(
      jwt,
      redis.asService(),
      users as unknown as UsersService,
      config as never,
    );
  });

  it('signs access and refresh tokens with different secrets and types', async () => {
    const { accessToken, refreshToken } = await service.issueTokenPair(user);

    const access = await jwt.verifyAsync(accessToken, {
      secret: ACCESS_SECRET,
    });
    expect(access).toMatchObject({ sub: user.id, type: 'access', tv: 0 });

    await expect(
      jwt.verifyAsync(refreshToken, { secret: ACCESS_SECRET }),
    ).rejects.toThrow();
    const refresh = await jwt.verifyAsync(refreshToken, {
      secret: REFRESH_SECRET,
    });
    expect(refresh).toMatchObject({ sub: user.id, type: 'refresh' });
  });

  it('rotates a refresh token exactly once', async () => {
    const { refreshToken } = await service.issueTokenPair(user);

    const rotated = await service.rotateRefreshToken(refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.rotateRefreshToken(rotated.refreshToken),
    ).resolves.toBeDefined();
  });

  it('rejects an access token used as a refresh token', async () => {
    const { accessToken } = await service.issueTokenPair(user);
    await expect(
      service.rotateRefreshToken(accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token issued before the tokenVersion was bumped', async () => {
    const { refreshToken } = await service.issueTokenPair(user);
    users.getAuthUser.mockResolvedValue({ ...user, tokenVersion: 1 });

    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a user that is no longer usable', async () => {
    const { refreshToken } = await service.issueTokenPair(user);
    users.getAuthUser.mockResolvedValue(null);

    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('revokes a refresh token on logout and ignores garbage tokens', async () => {
    const { refreshToken } = await service.issueTokenPair(user);

    await service.revokeRefreshToken(refreshToken);
    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.revokeRefreshToken('not-a-token'),
    ).resolves.toBeUndefined();
  });
});
