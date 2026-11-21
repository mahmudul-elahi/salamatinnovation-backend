import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginMethod, SessionEndReason } from '@prisma/client';
import { FakeRedis } from '../../../../helpers/fake-redis.js';
import { makeUser } from '../../../../helpers/fixtures.js';
import { TokenService } from '../../../../../src/modules/auth/services/token.service.js';
import type { SessionService } from '../../../../../src/modules/auth/services/session.service.js';
import type { UsersService } from '../../../../../src/modules/users/users.service.js';

const ACCESS_SECRET = 'a'.repeat(40);
const REFRESH_SECRET = 'r'.repeat(40);
const CLIENT = { ipAddress: '203.0.113.7', userAgent: 'test-agent' };

/** In-memory SessionService: just enough state for the token flows. */
function fakeSessions() {
  const active = new Map<string, { userId: string; expiresAt: Date }>();
  return {
    active,
    create: vi.fn(
      async (s: { id: string; userId: string; expiresAt: Date }) => {
        active.set(s.id, { userId: s.userId, expiresAt: s.expiresAt });
      },
    ),
    findActive: vi.fn(async (id: string, userId: string) =>
      active.get(id)?.userId === userId ? { id } : null,
    ),
    extend: vi.fn(async (id: string, expiresAt: Date) => {
      active.get(id)!.expiresAt = expiresAt;
    }),
    revoke: vi.fn(async (_userId: string, id: string) => active.delete(id)),
  };
}

describe('TokenService', () => {
  let redis: FakeRedis;
  let jwt: JwtService;
  let users: { getAuthUser: ReturnType<typeof vi.fn> };
  let sessions: ReturnType<typeof fakeSessions>;
  let service: TokenService;
  const user = makeUser();

  beforeEach(() => {
    redis = new FakeRedis();
    jwt = new JwtService({
      secret: ACCESS_SECRET,
      signOptions: { expiresIn: '15m' },
    });
    sessions = fakeSessions();
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
      sessions as unknown as SessionService,
      config as never,
    );
  });

  it('signs access and refresh tokens with different secrets and types', async () => {
    const { accessToken, refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );

    const access = await jwt.verifyAsync(accessToken, {
      secret: ACCESS_SECRET,
    });
    expect(access).toMatchObject({ sub: user.id, type: 'access', tv: 0 });
    expect(access.sid).toEqual(expect.any(String));

    await expect(
      jwt.verifyAsync(refreshToken, { secret: ACCESS_SECRET }),
    ).rejects.toThrow();
    const refresh = await jwt.verifyAsync(refreshToken, {
      secret: REFRESH_SECRET,
    });
    expect(refresh).toMatchObject({
      sub: user.id,
      type: 'refresh',
      sid: access.sid,
    });
  });

  it('rotates a refresh token exactly once', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );

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
    const { accessToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    await expect(
      service.rotateRefreshToken(accessToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token issued before the tokenVersion was bumped', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    users.getAuthUser.mockResolvedValue({ ...user, tokenVersion: 1 });

    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a refresh token for a user that is no longer usable', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    users.getAuthUser.mockResolvedValue(null);

    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('records a session for the login with its expiry and client', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSKEY,
      CLIENT,
    );
    const { sid, exp } = jwt.decode<{ sid: string; exp: number }>(refreshToken);

    expect(sessions.create).toHaveBeenCalledWith({
      id: sid,
      userId: user.id,
      loginMethod: LoginMethod.PASSKEY,
      client: CLIENT,
      expiresAt: new Date(exp * 1000),
    });
  });

  it('keeps the same session across refreshes and extends it', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    const rotated = await service.rotateRefreshToken(refreshToken);

    const before = jwt.decode<{ sid: string }>(refreshToken).sid;
    const after = jwt.decode<{ sid: string }>(rotated.refreshToken).sid;
    expect(after).toBe(before);
    expect(sessions.extend).toHaveBeenCalledWith(before, expect.any(Date));
  });

  it('rejects refreshing a session that was signed out', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    sessions.active.clear();

    await expect(service.rotateRefreshToken(refreshToken)).rejects.toThrow(
      /signed out/,
    );
  });

  it('continues an existing session with a fresh token pair', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    const sid = jwt.decode<{ sid: string }>(refreshToken).sid;

    const next = await service.continueSession(user, sid);
    expect(jwt.decode<{ sid: string }>(next.accessToken).sid).toBe(sid);
    expect(next.user.email).toBe(user.email);
    expect(sessions.create).toHaveBeenCalledOnce();
  });

  it('logs out the session on logout and ignores garbage tokens', async () => {
    const { refreshToken } = await service.startSession(
      user,
      LoginMethod.PASSWORD,
      CLIENT,
    );
    const sid = jwt.decode<{ sid: string }>(refreshToken).sid;

    await service.revokeRefreshToken(refreshToken);
    expect(sessions.revoke).toHaveBeenCalledWith(
      user.id,
      sid,
      SessionEndReason.LOGOUT,
    );
    await expect(
      service.rotateRefreshToken(refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.revokeRefreshToken('not-a-token'),
    ).resolves.toBeUndefined();
  });

  it('rejects refresh tokens issued before sessions existed (no sid)', async () => {
    const legacy = await jwt.signAsync(
      { sub: user.id, tv: 0, jti: 'old-jti', type: 'refresh' },
      { secret: REFRESH_SECRET, expiresIn: '7d' },
    );
    await redis.set('refresh_token:old-jti', user.id, 60_000);

    await expect(service.rotateRefreshToken(legacy)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
