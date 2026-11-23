import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env.schema.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { PasswordController } from './controllers/password.controller.js';
import { PasskeyController } from './controllers/passkey.controller.js';
import { AuthService } from './services/auth.service.js';
import { TokenService } from './services/token.service.js';
import { PasswordService } from './services/password.service.js';
import { PasskeyService } from './services/passkey.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // Configured for access tokens; TokenService passes the refresh secret explicitly.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', {
            infer: true,
          }) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController, PasswordController, PasskeyController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    PasskeyService,
    JwtStrategy,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
