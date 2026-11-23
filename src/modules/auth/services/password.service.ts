import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// @node-rs/bcrypt defaults to cost 12.
import { compare, hash } from '@node-rs/bcrypt';
import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import { MailService } from '../../../infrastructure/mail/mail.service.js';
import { UsersService } from '../../users/users.service.js';
import {
  OTP_COOLDOWN_MS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  RESET_TOKEN_TTL_MS,
  RedisKeys,
} from '../auth.constants.js';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from '../dto/password.dto.js';
import type {
  ChangePasswordResponseDto,
  MessageResponseDto,
  OtpRequestedDto,
  OtpVerifiedDto,
} from '../dto/auth-response.dto.js';
import { TokenService } from './token.service.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class PasswordService {
  constructor(
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Sends a reset OTP. The response and the cooldown are identical whether or
   * not the email is registered, so the endpoint cannot be used to discover
   * accounts.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<OtpRequestedDto> {
    const email = UsersService.normalizeEmail(dto.email);
    const response: OtpRequestedDto = {
      message:
        'If this email is registered, a 6-digit OTP code has been sent to your inbox.',
      expiresInSeconds: OTP_TTL_MS / 1000,
    };

    const acquired = await this.redis.setIfAbsent(
      RedisKeys.otpCooldown(email),
      '1',
      OTP_COOLDOWN_MS,
    );
    if (!acquired) {
      throw new HttpException(
        `Please wait ${OTP_COOLDOWN_MS / 1000} seconds before requesting another OTP code.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.users.findByEmail(email);
    if (!UsersService.isUsable(user)) {
      return response;
    }

    const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Only a hash of the OTP is stored; a fresh OTP also resets the attempt counter.
    await this.redis.set(
      RedisKeys.otp(email),
      sha256(otp).toString('hex'),
      OTP_TTL_MS,
    );
    await this.redis.del(RedisKeys.otpAttempts(email));

    await this.mail.sendPasswordResetOtp({
      email,
      otp,
      firstName: user.firstName,
      expiresInMinutes: OTP_TTL_MS / 60_000,
    });

    return response;
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<OtpVerifiedDto> {
    const email = UsersService.normalizeEmail(dto.email);
    const otpKey = RedisKeys.otp(email);
    const attemptsKey = RedisKeys.otpAttempts(email);

    const storedHash = await this.redis.get(otpKey);
    if (!storedHash) {
      throw new BadRequestException(
        'OTP code has expired or is invalid. Please request a new code.',
      );
    }

    // Counted atomically before comparing, so parallel guesses cannot exceed the limit.
    const attempt = await this.redis.increment(attemptsKey, OTP_TTL_MS);
    if (attempt > OTP_MAX_ATTEMPTS) {
      await this.redis.del(otpKey, attemptsKey);
      throw new BadRequestException(
        'Too many invalid attempts. This OTP has been invalidated. Please request a new code.',
      );
    }

    const matches = timingSafeEqual(
      Buffer.from(storedHash, 'hex'),
      sha256(dto.otp.trim()),
    );
    if (!matches) {
      const remaining = OTP_MAX_ATTEMPTS - attempt;
      throw new BadRequestException(
        `Invalid OTP code. ${remaining} attempt(s) remaining.`,
      );
    }

    // Consume the OTP so it cannot be verified twice.
    if ((await this.redis.consume(otpKey)) === null) {
      throw new BadRequestException(
        'OTP code has expired or is invalid. Please request a new code.',
      );
    }
    await this.redis.del(attemptsKey);

    const resetToken = randomUUID();
    await this.redis.set(
      RedisKeys.resetToken(resetToken),
      email,
      RESET_TOKEN_TTL_MS,
    );

    return {
      message:
        'OTP verified successfully. You may now proceed to reset your password.',
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<MessageResponseDto> {
    const email = await this.redis.consume(RedisKeys.resetToken(dto.token));
    if (!email) {
      throw new BadRequestException(
        'Reset token has expired or is invalid. Please restart the password reset process.',
      );
    }

    const user = await this.users.findByEmail(email);
    if (!UsersService.isUsable(user)) {
      throw new NotFoundException(
        'User account no longer exists or is inactive.',
      );
    }

    // Also revokes every existing session (tokenVersion bump).
    await this.users.updatePassword(user.id, await hash(dto.newPassword));

    return {
      message:
        'Password has been reset successfully. You can now log in with your new password.',
    };
  }

  /**
   * Changes the password and revokes all other sessions. Returns a fresh token
   * pair so the caller's own session continues.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponseDto> {
    const user = await this.users.findById(userId);
    if (!user || user.deletedAt) {
      throw new NotFoundException('User profile not found.');
    }

    if (!(await compare(dto.currentPassword, user.password))) {
      throw new BadRequestException('Current password does not match.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from your current password.',
      );
    }

    const updated = await this.users.updatePassword(
      user.id,
      await hash(dto.newPassword),
    );
    const {
      accessToken,
      refreshToken,
      tokenType,
      user: profile,
    } = await this.tokens.buildAuthResponse(updated);

    return {
      message:
        'Password changed successfully. Other sessions have been signed out.',
      accessToken,
      refreshToken,
      tokenType,
      user: profile,
    };
  }
}
