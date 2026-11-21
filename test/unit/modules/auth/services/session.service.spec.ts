import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginMethod, SessionEndReason } from '@prisma/client';
import { FakeRedis } from '../../../../helpers/fake-redis.js';
import { RedisKeys } from '../../../../../src/modules/auth/auth.constants.js';
import {
  SessionService,
  sessionStatus,
} from '../../../../../src/modules/auth/services/session.service.js';
import type { PrismaService } from '../../../../../src/database/prisma.service.js';

const DAY = 24 * 60 * 60_000;

function makeSession(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'session-1',
    userId: 'user-1',
    loginMethod: LoginMethod.PASSWORD,
    ipAddress: '203.0.113.7',
    userAgent: 'curl/8.11.1',
    deviceName: 'curl',
    createdAt: now,
    lastActiveAt: now,
    expiresAt: new Date(now.getTime() + 7 * DAY),
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

describe('SessionService', () => {
  let redis: FakeRedis;
  let session: Record<string, ReturnType<typeof vi.fn>>;
  let service: SessionService;

  beforeEach(() => {
    redis = new FakeRedis();
    session = {
      create: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    };
    service = new SessionService(
      { session } as unknown as PrismaService,
      redis.asService(),
    );
  });

  it('records the device name and prunes old history on create', async () => {
    await service.create({
      id: 'session-1',
      userId: 'user-1',
      loginMethod: LoginMethod.PASSKEY,
      client: { ipAddress: '203.0.113.7', userAgent: 'PostmanRuntime/7.43.0' },
      expiresAt: new Date(),
    });

    expect(session.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'session-1',
        loginMethod: LoginMethod.PASSKEY,
        ipAddress: '203.0.113.7',
        deviceName: 'Postman',
      }),
    });
    expect(session.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'user-1' }),
    });
  });

  describe('isActive', () => {
    it('checks the database once, then answers from the cache', async () => {
      expect(await service.isActive('session-1', 'user-1')).toBe(true);
      expect(await service.isActive('session-1', 'user-1')).toBe(true);
      expect(session.updateMany).toHaveBeenCalledOnce();
    });

    it('is false for a session that is not active in the database', async () => {
      session.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.isActive('session-1', 'user-1')).toBe(false);
    });

    it('is false right after a revoke, even with "active" cached', async () => {
      await service.isActive('session-1', 'user-1');
      await service.revoke('user-1', 'session-1', SessionEndReason.LOGOUT);

      expect(await service.isActive('session-1', 'user-1')).toBe(false);
    });

    it('does not overwrite a revoke that lands during the database check', async () => {
      session.updateMany.mockImplementationOnce(async () => {
        // The revoke's marker is written while this request is mid-check.
        await redis.set(RedisKeys.sessionState('session-1'), 'revoked', 60_000);
        return { count: 1 };
      });

      await service.isActive('session-1', 'user-1');
      expect(await service.isActive('session-1', 'user-1')).toBe(false);
    });
  });

  it('only revokes sessions owned by the user', async () => {
    session.updateMany.mockResolvedValue({ count: 0 });
    expect(
      await service.revoke(
        'other-user',
        'session-1',
        SessionEndReason.SIGNED_OUT_REMOTELY,
      ),
    ).toBe(false);
    expect(session.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'session-1', userId: 'other-user' }),
      data: expect.objectContaining({
        revokedReason: SessionEndReason.SIGNED_OUT_REMOTELY,
      }),
    });
  });

  it('revokes every session except the one to keep', async () => {
    session.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    const count = await service.revokeAll(
      'user-1',
      SessionEndReason.PASSWORD_CHANGED,
      'keep-me',
    );

    expect(count).toBe(2);
    expect(session.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { not: 'keep-me' } }),
      select: { id: true },
    });
    expect(redis.has(RedisKeys.sessionState('a'))).toBe(true);
    expect(redis.has(RedisKeys.sessionState('keep-me'))).toBe(false);
  });

  it('marks the current session in listings', async () => {
    session.findMany.mockResolvedValue([
      makeSession({ id: 'mine' }),
      makeSession({ id: 'theirs' }),
    ]);

    const list = await service.listActive('user-1', 'mine');
    expect(list.map((s) => [s.id, s.current])).toEqual([
      ['mine', true],
      ['theirs', false],
    ]);
  });

  it('derives status from revocation and expiry', () => {
    expect(sessionStatus(makeSession())).toBe('active');
    expect(sessionStatus(makeSession({ revokedAt: new Date() }))).toBe(
      'revoked',
    );
    expect(
      sessionStatus(makeSession({ expiresAt: new Date(Date.now() - 1) })),
    ).toBe('expired');
  });
});
