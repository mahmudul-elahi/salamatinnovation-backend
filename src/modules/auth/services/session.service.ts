import { Injectable } from '@nestjs/common';
import {
  type LoginMethod,
  type Session,
  SessionEndReason,
} from '@prisma/client';
import type { ClientInfo } from '../../../common/decorators/client-info.decorator.js';
import {
  createPaginatedResult,
  type PaginatedResult,
} from '../../../common/pagination/paginated-result.interface.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import {
  RedisKeys,
  SESSION_HISTORY_RETENTION_MS,
  SESSION_STATE_CACHE_TTL_MS,
} from '../auth.constants.js';
import type { SessionDto } from '../dto/session.dto.js';
import { describeDevice } from '../utils/device-name.js';

const ACTIVE = 'active';
const REVOKED = 'revoked';

/**
 * Login sessions: one row per login on one device, ended by logout, by the
 * user from another device, or by a password change.
 *
 * The JWT strategy calls `isActive()` on every request. Its answer is cached
 * in Redis for up to SESSION_STATE_CACHE_TTL_MS, and revoking overwrites the
 * cache with "revoked", so a signed-out device is rejected on its next request.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(params: {
    id: string;
    userId: string;
    loginMethod: LoginMethod;
    client: ClientInfo;
    expiresAt: Date;
  }): Promise<void> {
    const { id, userId, loginMethod, client, expiresAt } = params;
    await this.prisma.session.create({
      data: {
        id,
        userId,
        loginMethod,
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        deviceName: describeDevice(client.userAgent),
        expiresAt,
      },
    });
    await this.pruneHistory(userId);
  }

  /** Returns the session if it belongs to the user and has not ended. */
  findActive(sessionId: string, userId: string) {
    return this.prisma.session.findFirst({
      where: { id: sessionId, userId, ...activeFilter() },
    });
  }

  /** Called on refresh: the session now lasts until the new refresh token expires. */
  async extend(sessionId: string, expiresAt: Date): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { expiresAt, lastActiveAt: new Date() },
    });
  }

  /**
   * Whether the session can still be used. A cache miss checks the database
   * and also records the session as active now, so `lastActiveAt` stays
   * accurate to within the cache TTL without a write on every request.
   */
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const key = RedisKeys.sessionState(sessionId);
    const cached = await this.redis.get(key);
    if (cached !== null) return cached === ACTIVE;

    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, ...activeFilter() },
      data: { lastActiveAt: new Date() },
    });
    const active = count === 1;

    // setIfAbsent: if a revoke landed while we read the database, its
    // "revoked" marker wins over our "active".
    await this.redis.setIfAbsent(
      key,
      active ? ACTIVE : REVOKED,
      SESSION_STATE_CACHE_TTL_MS,
    );
    return active;
  }

  async listActive(
    userId: string,
    currentSessionId?: string,
  ): Promise<SessionDto[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, ...activeFilter() },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions.map((s) => toSessionDto(s, currentSessionId));
  }

  /** Every session, including ended ones, newest first. */
  async history(
    userId: string,
    page: number,
    limit: number,
    currentSessionId?: string,
  ): Promise<PaginatedResult<SessionDto>> {
    const [sessions, total] = await Promise.all([
      this.prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.session.count({ where: { userId } }),
    ]);
    return createPaginatedResult(
      sessions.map((s) => toSessionDto(s, currentSessionId)),
      total,
      page,
      limit,
    );
  }

  /** Ends one of the user's sessions. Returns false if it was not active. */
  async revoke(
    userId: string,
    sessionId: string,
    reason: SessionEndReason,
  ): Promise<boolean> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, ...activeFilter() },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.markRevoked([sessionId]);
    return count === 1;
  }

  /**
   * Ends every active session of the user, optionally keeping one (the
   * caller's own). Returns how many were ended.
   */
  async revokeAll(
    userId: string,
    reason: SessionEndReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const where = {
      userId,
      ...activeFilter(),
      ...(exceptSessionId && { id: { not: exceptSessionId } }),
    };
    const sessions = await this.prisma.session.findMany({
      where,
      select: { id: true },
    });
    if (sessions.length === 0) return 0;

    const ids = sessions.map((s) => s.id);
    await this.prisma.session.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await this.markRevoked(ids);
    return ids.length;
  }

  private async markRevoked(sessionIds: string[]): Promise<void> {
    await Promise.all(
      sessionIds.map((id) =>
        this.redis.set(
          RedisKeys.sessionState(id),
          REVOKED,
          SESSION_STATE_CACHE_TTL_MS,
        ),
      ),
    );
  }

  /** Drops sessions that ended longer ago than the history retention period. */
  private async pruneHistory(userId: string): Promise<void> {
    const cutoff = new Date(Date.now() - SESSION_HISTORY_RETENTION_MS);
    await this.prisma.session.deleteMany({
      where: {
        userId,
        OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
      },
    });
  }
}

const activeFilter = () => ({
  revokedAt: null,
  expiresAt: { gt: new Date() },
});

export function sessionStatus(session: Session): SessionDto['status'] {
  if (session.revokedAt) return 'revoked';
  if (session.expiresAt <= new Date()) return 'expired';
  return 'active';
}

function toSessionDto(session: Session, currentSessionId?: string): SessionDto {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    status: sessionStatus(session),
    loginMethod: session.loginMethod,
    deviceName: session.deviceName,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    revokedReason: session.revokedReason,
  };
}
