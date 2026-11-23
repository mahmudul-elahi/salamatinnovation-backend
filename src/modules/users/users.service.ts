import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';

/** Prisma include that loads a user's role together with its permissions. */
export const userWithPermissionsInclude = {
  role: { include: { permissions: { include: { permission: true } } } },
} satisfies Prisma.UserInclude;

export type UserWithPermissions = Prisma.UserGetPayload<{
  include: typeof userWithPermissionsInclude;
}>;

/** What the JWT strategy needs per request; cached briefly in Redis. */
export interface AuthUserRecord extends AuthenticatedUser {
  tokenVersion: number;
  isActive: boolean;
}

const AUTH_USER_CACHE_TTL_MS = 60_000;
const authUserCacheKey = (userId: string) => `auth_user:${userId}`;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  static toAuthenticatedUser(user: UserWithPermissions): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: { id: user.role.id, name: user.role.name, slug: user.role.slug },
      permissions: user.role.permissions.map((rp) => rp.permission.name),
    };
  }

  /** Returns the user only if it exists, is active and is not soft-deleted. */
  static isUsable<T extends { isActive: boolean; deletedAt: Date | null }>(
    user: T | null | undefined,
  ): user is T {
    return !!user && user.isActive && !user.deletedAt;
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: UsersService.normalizeEmail(email) },
    });
  }

  findWithPermissionsById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: userWithPermissionsInclude,
    });
  }

  findWithPermissionsByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email: UsersService.normalizeEmail(email) },
      include: userWithPermissionsInclude,
    });
  }

  /**
   * Loads the authenticated-user view used on every request, served from a
   * short-lived Redis cache. Returns null for missing/inactive/deleted users.
   */
  async getAuthUser(userId: string): Promise<AuthUserRecord | null> {
    const cached = await this.redis.getJson<AuthUserRecord>(
      authUserCacheKey(userId),
    );
    if (cached) {
      return cached;
    }

    const user = await this.findWithPermissionsById(userId);
    if (!UsersService.isUsable(user)) {
      return null;
    }

    const record: AuthUserRecord = {
      ...UsersService.toAuthenticatedUser(user),
      tokenVersion: user.tokenVersion,
      isActive: user.isActive,
    };
    await this.redis.setJson(
      authUserCacheKey(userId),
      record,
      AUTH_USER_CACHE_TTL_MS,
    );
    return record;
  }

  /** Call after any change to a user's status, role or permissions. */
  async invalidateAuthCache(userId: string): Promise<void> {
    await this.redis.del(authUserCacheKey(userId));
  }

  /**
   * Updates the password hash and bumps `tokenVersion`, which revokes every
   * access and refresh token issued before this call.
   */
  async updatePassword(userId: string, passwordHash: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { password: passwordHash, tokenVersion: { increment: 1 } },
      include: userWithPermissionsInclude,
    });
    await this.invalidateAuthCache(userId);
    return user;
  }

  /** Revokes every token issued to the user ("log out everywhere"). */
  async revokeAllTokens(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.invalidateAuthCache(userId);
  }
}
