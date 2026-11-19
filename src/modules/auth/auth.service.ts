import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { compare, hash } from '@node-rs/bcrypt';
import { randomInt, randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRegisterVerifyDto,
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
  private readonly rpName: string;
  private readonly rpID: string;
  private readonly expectedOrigins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.rpName =
      this.configService?.get<string>('webauthn.rpName') ||
      process.env.WEBAUTHN_RP_NAME ||
      'Salamat POS & ERP';
    this.rpID =
      this.configService?.get<string>('webauthn.rpID') ||
      process.env.WEBAUTHN_RP_ID ||
      'localhost';
    const origins =
      this.configService?.get<string | string[]>('webauthn.origin') ||
      process.env.WEBAUTHN_ORIGIN ||
      'http://localhost:3000,http://localhost:5173';
    this.expectedOrigins = Array.isArray(origins)
      ? origins
      : typeof origins === 'string'
        ? origins.split(',').map((o) => o.trim())
        : ['http://localhost:3000'];
  }

  private async buildAuthResponse(user: any) {
    const permissions = user.role.permissions.map(
      (rp: any) => rp.permission.name,
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
        'Your account has been deactivated. Please contact your administrator.',
      );
    }

    const isPasswordValid = await compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.buildAuthResponse(user);
  }

  async refreshToken(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.isActive || user.deletedAt) {
        throw new UnauthorizedException(
          'User no longer exists or is inactive.',
        );
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
      throw new BadRequestException(
        'Invalid OTP state. Please request a new code.',
      );
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
      throw new NotFoundException(
        'User account no longer exists or is inactive.',
      );
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

    const permissions = user.role.permissions.map((rp) => rp.permission.name);

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

  // ==========================================
  // Passkey / WebAuthn Biometric Authentication
  // ==========================================

  async generatePasskeyRegistrationOptions(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { passkeys: true },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException('User profile not found.');
    }

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as any,
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    const challengeKey = `passkey_reg_challenge:${userId}`;
    await this.cacheManager.set(challengeKey, options.challenge, 300000);

    return options;
  }

  async verifyPasskeyRegistration(
    userId: string,
    dto: PasskeyRegisterVerifyDto,
  ) {
    const challengeKey = `passkey_reg_challenge:${userId}`;
    const expectedChallenge = await this.cacheManager.get<string>(challengeKey);

    if (!expectedChallenge) {
      throw new BadRequestException(
        'Passkey registration session has expired. Please try registering again.',
      );
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.response as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new BadRequestException(`Passkey verification error: ${err.message}`);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException(
        'Passkey registration could not be verified by authenticator.',
      );
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    const passkey = await this.prisma.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        transports: (dto.response?.response?.transports as string[]) || [],
        name: dto.name?.trim() || 'Biometric Passkey',
      },
    });

    await this.cacheManager.del(challengeKey);

    return {
      message: 'Passkey registered successfully.',
      passkey: {
        id: passkey.id,
        name: passkey.name,
        deviceType: passkey.deviceType,
        createdAt: passkey.createdAt,
      },
    };
  }

  async generatePasskeyLoginOptions(dto?: PasskeyLoginOptionsDto) {
    let allowCredentials;

    if (dto?.email) {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email.trim().toLowerCase() },
        include: { passkeys: true },
      });

      if (user?.passkeys.length) {
        allowCredentials = user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: p.transports as any,
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    const challengeKey = `passkey_auth_challenge:${options.challenge}`;
    await this.cacheManager.set(challengeKey, options.challenge, 300000);

    return options;
  }

  async verifyPasskeyLogin(dto: PasskeyLoginVerifyDto) {
    const rawResponse = dto.response as AuthenticationResponseJSON;
    const credentialId = rawResponse?.id;

    if (!credentialId) {
      throw new BadRequestException(
        'Missing credential ID in passkey authentication response.',
      );
    }

    let expectedChallenge: string | null = null;
    if (rawResponse?.response?.clientDataJSON) {
      try {
        const clientData = JSON.parse(
          Buffer.from(
            rawResponse.response.clientDataJSON,
            'base64url',
          ).toString('utf-8'),
        );
        expectedChallenge = clientData.challenge;
      } catch {
        // Ignored
      }
    }

    if (!expectedChallenge) {
      throw new BadRequestException(
        'Could not parse challenge from biometric assertion.',
      );
    }

    const challengeKey = `passkey_auth_challenge:${expectedChallenge}`;
    const storedChallenge = await this.cacheManager.get<string>(challengeKey);

    if (!storedChallenge) {
      throw new BadRequestException(
        'Passkey login session has expired or is invalid. Please restart login.',
      );
    }

    const passkey = await this.prisma.passkey.findUnique({
      where: { credentialId },
      include: {
        user: {
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
        },
      },
    });

    if (
      !passkey ||
      !passkey.user ||
      !passkey.user.isActive ||
      passkey.user.deletedAt
    ) {
      throw new UnauthorizedException(
        'Unrecognized or deactivated biometric passkey.',
      );
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: rawResponse,
        expectedChallenge: storedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: passkey.publicKey,
          counter: Number(passkey.counter),
          transports: passkey.transports as any,
        },
        requireUserVerification: true,
      });
    } catch (err: any) {
      throw new UnauthorizedException(
        `Biometric signature verification failed: ${err.message}`,
      );
    }

    if (!verification.verified) {
      throw new UnauthorizedException(
        'Biometric authentication verification failed.',
      );
    }

    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    await this.cacheManager.del(challengeKey);

    return this.buildAuthResponse(passkey.user);
  }

  async listUserPasskeys(userId: string) {
    return this.prisma.passkey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteUserPasskey(userId: string, passkeyId: string) {
    const passkey = await this.prisma.passkey.findFirst({
      where: { id: passkeyId, userId },
    });

    if (!passkey) {
      throw new NotFoundException('Passkey device not found.');
    }

    await this.prisma.passkey.delete({
      where: { id: passkeyId },
    });

    return {
      message: 'Passkey deleted successfully.',
    };
  }
}
