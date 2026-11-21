import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../../config/env.schema.js';
import type { RequestUser } from '../../../common/decorators/current-user.decorator.js';
import { UsersService } from '../../users/users.service.js';
import { SessionService } from '../services/session.service.js';
import type { AccessTokenPayload } from '../services/token.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<RequestUser> {
    // Tokens without `sid` predate login sessions; they must log in again.
    if (payload.type !== 'access' || !payload.sid) {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.users.getAuthUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User account is inactive or not found');
    }
    if (user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException(
        'Session has been revoked. Please log in again.',
      );
    }

    if (!(await this.sessions.isActive(payload.sid, payload.sub))) {
      throw new UnauthorizedException(
        'This session has been signed out. Please log in again.',
      );
    }

    const { tokenVersion: _tv, isActive: _active, ...authenticated } = user;
    return { ...authenticated, sessionId: payload.sid };
  }
}
