import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { type LoginMethod, SessionEndReason } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ClientInfo } from '../../../common/decorators/client-info.decorator.js';
import type { Env } from '../../../config/env.schema.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import {
  UsersService,
  type UserWithPermissions,
} from '../../users/users.service.js';
import { RedisKeys } from '../auth.constants.js';
import type {
  AuthResponseDto,
  TokenPairDto,
} from '../dto/auth-response.dto.js';
import { SessionService } from './session.service.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** User's tokenVersion at issue time; a mismatch means the token was revoked. */
  tv: number;
  /** Login session id; ending the session revokes the token. */
  sid: string;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  tv: number;
  sid: string;
  jti: string;
  type: 'refresh';
  exp: number;
}

type ExpiresIn = JwtSignOptions['expiresIn'];

interface TokenUser {
  id: string;
  email: string;
  tokenVersion: number;
  role: { slug: string };
}

/**
 * Issues and rotates JWTs.
 *
 * - Access and refresh tokens use different secrets and carry a `type` claim,
 *   so neither can stand in for the other.
 * - Every refresh token has a `jti` stored in Redis. Refreshing consumes it
 *   atomically (rotation), so a refresh token works exactly once; logout
 *   deletes it.
 * - Both carry `tv` (tokenVersion). Bumping the user's tokenVersion revokes
 *   everything issued earlier.
 * - Both carry `sid`, the login session (see SessionService). Ending a
 *   session revokes its tokens, which is how one device is signed out.
 */
@Injectable()
export class TokenService {
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: ExpiresIn;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
    this.refreshExpiresIn = config.get('JWT_REFRESH_EXPIRES_IN', {
      infer: true,
    }) as ExpiresIn;
  }

  /** Starts a new login session and returns its first token pair. */
  async startSession(
    user: UserWithPermissions,
    loginMethod: LoginMethod,
    client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const sessionId = randomUUID();
    const { tokens, jti, expiresAt } = await this.signTokenPair(
      user,
      sessionId,
    );
    await this.sessions.create({
      id: sessionId,
      userId: user.id,
      loginMethod,
      client,
      expiresAt,
    });
    await this.storeRefreshToken(jti, user.id, expiresAt);
    return withUser(tokens, user);
  }

  /**
   * Issues a new token pair for an existing session, e.g. after a password
   * change bumped the tokenVersion but the caller should stay signed in.
   */
  async continueSession(
    user: UserWithPermissions,
    sessionId: string,
  ): Promise<AuthResponseDto> {
    const tokens = await this.issueForSession(user, sessionId);
    return withUser(tokens, user);
  }

  /** Validates and consumes a refresh token, returning a fresh token pair. */
  async rotateRefreshToken(refreshToken: string): Promise<TokenPairDto> {
    const payload = await this.verifyRefreshToken(refreshToken);

    const ownerId = await this.redis.consume(
      RedisKeys.refreshToken(payload.jti),
    );
    if (ownerId !== payload.sub) {
      // Already used, logged out, or expired from the store.
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.users.getAuthUser(payload.sub);
    if (!user || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const session = await this.sessions.findActive(payload.sid, payload.sub);
    if (!session) {
      throw new UnauthorizedException(
        'This session has been signed out. Please log in again.',
      );
    }

    return this.issueForSession(user, payload.sid);
  }

  /**
   * Logs out the session a refresh token belongs to, which also revokes its
   * access token. Silently ignores invalid tokens.
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.verifyRefreshToken(refreshToken);
    } catch {
      return; // Logging out with an already-invalid token is a no-op.
    }
    await this.redis.del(RedisKeys.refreshToken(payload.jti));
    await this.sessions.revoke(
      payload.sub,
      payload.sid,
      SessionEndReason.LOGOUT,
    );
  }

  private async issueForSession(
    user: TokenUser,
    sessionId: string,
  ): Promise<TokenPairDto> {
    const { tokens, jti, expiresAt } = await this.signTokenPair(
      user,
      sessionId,
    );
    await this.storeRefreshToken(jti, user.id, expiresAt);
    await this.sessions.extend(sessionId, expiresAt);
    return tokens;
  }

  private async signTokenPair(
    user: TokenUser,
    sessionId: string,
  ): Promise<{ tokens: TokenPairDto; jti: string; expiresAt: Date }> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.slug,
      tv: user.tokenVersion,
      sid: sessionId,
      type: 'access',
    };
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload),
      this.jwt.signAsync(
        {
          sub: user.id,
          tv: user.tokenVersion,
          sid: sessionId,
          jti,
          type: 'refresh',
        },
        { secret: this.refreshSecret, expiresIn: this.refreshExpiresIn },
      ),
    ]);

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    return {
      tokens: { accessToken, refreshToken, tokenType: 'Bearer' },
      jti,
      expiresAt: new Date(exp * 1000),
    };
  }

  /** Records the refresh token's jti so it can be used exactly once. */
  private async storeRefreshToken(
    jti: string,
    userId: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.redis.set(
      RedisKeys.refreshToken(jti),
      userId,
      Math.max(1, expiresAt.getTime() - Date.now()),
    );
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    if (payload.type !== 'refresh' || !payload.jti || !payload.sid) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    return payload;
  }
}

function withUser(
  { accessToken, refreshToken, tokenType }: TokenPairDto,
  user: UserWithPermissions,
): AuthResponseDto {
  return {
    accessToken,
    refreshToken,
    tokenType,
    user: UsersService.toAuthenticatedUser(user),
  };
}
