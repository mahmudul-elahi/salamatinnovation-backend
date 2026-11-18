import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { compare, hash } from '@node-rs/bcrypt';
import { randomInt, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';
import { JwtPayload } from './jwt.strategy.js';

interface StoredOtpData {
  otp: string;
  attempts: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account has been deactivated. Please contact support.',
      );
    }

    const isPasswordValid = await compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const permissions = user.role.permissions.map(
      (rp) => rp.permission.name,
    );

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role.slug,
    };

    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.jwtService.signAsync(payload, {
      expiresIn: '7d',
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: {
          id: user.role.id,
          name: user.role.name,
          slug: user.role.slug,
        },
        permissions,
      },
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive || user.deletedAt) {
        throw new UnauthorizedException('User no longer exists or is inactive.');
      }

      const newPayload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: payload.role,
      };

      const accessToken = await this.jwtService.signAsync(newPayload);
      return {
        accessToken,
        tokenType: 'Bearer',
      };
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive || user.deletedAt) {
      return {
        message:
          'If this email is registered, a 6-digit OTP code has been sent to your inbox.',
        expiresInSeconds: 600,
      };
    }

    const cooldownKey = `otp_cooldown:${normalizedEmail}`;
    const isInCooldown = await this.cacheManager.get(cooldownKey);
    if (isInCooldown) {
      throw new HttpException(
        'Please wait 60 seconds before requesting another OTP code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otp = randomInt(100000, 1000000).toString();
    const otpKey = `otp:${normalizedEmail}`;
    const otpData: StoredOtpData = { otp, attempts: 0 };

    await this.cacheManager.set(otpKey, JSON.stringify(otpData), 600000);
    await this.cacheManager.set(cooldownKey, '1', 60000);

    await this.mailService.sendPasswordResetOtp(
      normalizedEmail,
      otp,
      user.firstName,
    );

    return {
      message:
        'If this email is registered, a 6-digit OTP code has been sent to your inbox.',
      expiresInSeconds: 600,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const otpKey = `otp:${normalizedEmail}`;

    const rawData = await this.cacheManager.get<string>(otpKey);
    if (!rawData) {
      throw new BadRequestException(
        'OTP code has expired or is invalid. Please request a new code.',
      );
    }

    let stored: StoredOtpData;
    try {
      stored = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch {
      throw new BadRequestException('Invalid OTP state. Please request a new code.');
    }

    if (stored.attempts >= 5) {
      await this.cacheManager.del(otpKey);
      throw new BadRequestException(
        'Too many invalid attempts. This OTP has been invalidated. Please request a new code.',
      );
    }

    if (stored.otp !== dto.otp.trim()) {
      stored.attempts += 1;
      await this.cacheManager.set(otpKey, JSON.stringify(stored), 600000);
      const remaining = 5 - stored.attempts;
      throw new BadRequestException(
        `Invalid OTP code. ${remaining} attempt(s) remaining.`,
      );
    }

    const resetToken = randomUUID();
    const tokenKey = `reset_token:${resetToken}`;

    await this.cacheManager.set(tokenKey, normalizedEmail, 900000);
    await this.cacheManager.del(otpKey);

    return {
      message:
        'OTP verified successfully. You may now proceed to reset your password.',
      resetToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenKey = `reset_token:${dto.token}`;
    const email = await this.cacheManager.get<string>(tokenKey);

    if (!email) {
      throw new BadRequestException(
        'Reset token has expired or is invalid. Please restart the password reset process.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new NotFoundException('User account no longer exists or is inactive.');
    }

    const hashedPassword = await hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await this.cacheManager.del(tokenKey);

    return {
      message:
        'Password has been reset successfully. You can now log in with your new password.',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User profile not found.');
    }

    const isCurrentPasswordValid = await compare(
      dto.currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new BadRequestException('Current password does not match.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from your current password.',
      );
    }

    const hashedPassword = await hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return {
      message: 'Password changed successfully.',
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User profile not found');
    }

    const permissions = user.role.permissions.map(
      (rp) => rp.permission.name,
    );

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      isActive: user.isActive,
      role: {
        id: user.role.id,
        name: user.role.name,
        slug: user.role.slug,
      },
      permissions,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
