import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../../config/env.schema.js';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator.js';
import { UsersService } from '../../users/users.service.js';
import type { AccessTokenPayload } from '../services/token.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
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

    const { tokenVersion: _tv, isActive: _active, ...authenticated } = user;
    return authenticated;
  }
}
