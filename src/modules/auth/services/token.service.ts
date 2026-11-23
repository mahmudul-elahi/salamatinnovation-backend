import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
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

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: string;
  /** User's tokenVersion at issue time; a mismatch means the token was revoked. */
  tv: number;
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  tv: number;
  jti: string;
  type: 'refresh';
  exp: number;
}

type ExpiresIn = JwtSignOptions['expiresIn'];

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
 */
@Injectable()
export class TokenService {
  private readonly refreshSecret: string;
  private readonly refreshExpiresIn: ExpiresIn;

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    config: ConfigService<Env, true>,
  ) {
    this.refreshSecret = config.get('JWT_REFRESH_SECRET', { infer: true });
    this.refreshExpiresIn = config.get('JWT_REFRESH_EXPIRES_IN', {
      infer: true,
    }) as ExpiresIn;
  }

  async issueTokenPair(user: {
    id: string;
    email: string;
    tokenVersion: number;
    role: { slug: string };
  }): Promise<TokenPairDto> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.slug,
      tv: user.tokenVersion,
      type: 'access',
    };
    const jti = randomUUID();

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload),
      this.jwt.signAsync(
        { sub: user.id, tv: user.tokenVersion, jti, type: 'refresh' },
        { secret: this.refreshSecret, expiresIn: this.refreshExpiresIn },
      ),
    ]);

    const { exp } = this.jwt.decode<{ exp: number }>(refreshToken);
    await this.redis.set(
      RedisKeys.refreshToken(jti),
      user.id,
      Math.max(1, exp * 1000 - Date.now()),
    );

    return { accessToken, refreshToken, tokenType: 'Bearer' };
  }

  /** Full login response: token pair plus the user's profile and permissions. */
  async buildAuthResponse(user: UserWithPermissions): Promise<AuthResponseDto> {
    const { accessToken, refreshToken, tokenType } =
      await this.issueTokenPair(user);
    return {
      accessToken,
      refreshToken,
      tokenType,
      user: UsersService.toAuthenticatedUser(user),
    };
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

    return this.issueTokenPair(user);
  }

  /** Revokes a single refresh token. Silently ignores invalid tokens. */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      const payload = await this.verifyRefreshToken(refreshToken);
      await this.redis.del(RedisKeys.refreshToken(payload.jti));
    } catch {
      // Logging out with an already-invalid token is a no-op.
    }
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
    if (payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
    return payload;
  }
}
