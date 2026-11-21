import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from '@node-rs/bcrypt';
import { LoginMethod, SessionEndReason } from '@prisma/client';
import type { ClientInfo } from '../../../common/decorators/client-info.decorator.js';
import { UsersService } from '../../users/users.service.js';
import type { LoginDto } from '../dto/login.dto.js';
import type {
  AuthResponseDto,
  MessageResponseDto,
  ProfileDto,
  TokenPairDto,
} from '../dto/auth-response.dto.js';
import { SessionService } from './session.service.js';
import { TokenService } from './token.service.js';

// Compared against when the email is unknown, so response time does not reveal
// whether an account exists. (bcrypt hash of a random throwaway string.)
const DUMMY_PASSWORD_HASH =
  '$2b$12$eXtOrJmCFGZzhcJKkWtEIerJ1qpm4rMDfEw95V7fkw8pw/ObV9Bdm';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async login(
    { email, password }: LoginDto,
    client: ClientInfo,
  ): Promise<AuthResponseDto> {
    const user = await this.users.findWithPermissionsByEmail(email);

    const passwordValid = await compare(
      password,
      user?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || user.deletedAt || !passwordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Please contact your administrator.',
      );
    }

    return this.tokens.startSession(user, LoginMethod.PASSWORD, client);
  }

  refresh(refreshToken: string): Promise<TokenPairDto> {
    return this.tokens.rotateRefreshToken(refreshToken);
  }

  async logout(refreshToken: string): Promise<MessageResponseDto> {
    await this.tokens.revokeRefreshToken(refreshToken);
    return { message: 'Logged out successfully.' };
  }

  async logoutAll(userId: string): Promise<MessageResponseDto> {
    await this.users.revokeAllTokens(userId);
    await this.sessions.revokeAll(userId, SessionEndReason.LOGOUT_ALL);
    return { message: 'All sessions have been signed out.' };
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    const user = await this.users.findWithPermissionsById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User profile not found');
    }

    return {
      ...UsersService.toAuthenticatedUser(user),
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
