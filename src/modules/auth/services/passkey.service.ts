import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import type { Env } from '../../../config/env.schema.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RedisService } from '../../../infrastructure/redis/redis.service.js';
import {
  UsersService,
  userWithPermissionsInclude,
} from '../../users/users.service.js';
import { PASSKEY_CHALLENGE_TTL_MS, RedisKeys } from '../auth.constants.js';
import {
  asAuthenticationResponse,
  asRegistrationResponse,
  type PasskeyLoginOptionsDto,
  type PasskeyLoginVerifyDto,
  type PasskeyRegisterVerifyDto,
} from '../dto/passkey.dto.js';
import type {
  AuthResponseDto,
  MessageResponseDto,
  PasskeyRegisteredDto,
  PasskeySummaryDto,
} from '../dto/auth-response.dto.js';
import { TokenService } from './token.service.js';

const toTransports = (transports: string[]) =>
  transports as AuthenticatorTransport[];

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);
  private readonly rpName: string;
  private readonly rpID: string;
  private readonly expectedOrigins: string[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    config: ConfigService<Env, true>,
  ) {
    this.rpName = config.get('WEBAUTHN_RP_NAME', { infer: true });
    this.rpID = config.get('WEBAUTHN_RP_ID', { infer: true });
    this.expectedOrigins = config.get('WEBAUTHN_ORIGIN', { infer: true });
  }

  async generateRegistrationOptions(
    userId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
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
        transports: toTransports(p.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    await this.redis.set(
      RedisKeys.passkeyRegistrationChallenge(userId),
      options.challenge,
      PASSKEY_CHALLENGE_TTL_MS,
    );
    return options;
  }

  async verifyRegistration(
    userId: string,
    dto: PasskeyRegisterVerifyDto,
  ): Promise<PasskeyRegisteredDto> {
    // Single use: consumed before verification so a failed attempt cannot be replayed.
    const expectedChallenge = await this.redis.consume(
      RedisKeys.passkeyRegistrationChallenge(userId),
    );
    if (!expectedChallenge) {
      throw new BadRequestException(
        'Passkey registration session has expired. Please try registering again.',
      );
    }

    const response = asRegistrationResponse(dto.response);
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      this.logger.warn(
        `[PASSKEY] Registration verification failed for user ${userId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Passkey registration could not be verified.',
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException(
        'Passkey registration could not be verified.',
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
        transports: response.response.transports ?? [],
        name: dto.name?.trim() || 'Biometric Passkey',
      },
    });

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

  async generateLoginOptions(
    dto?: PasskeyLoginOptionsDto,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    let allowCredentials:
      { id: string; transports: AuthenticatorTransport[] }[] | undefined;

    if (dto?.email) {
      const user = await this.prisma.user.findUnique({
        where: { email: UsersService.normalizeEmail(dto.email) },
        include: { passkeys: true },
      });
      if (user?.passkeys.length) {
        allowCredentials = user.passkeys.map((p) => ({
          id: p.credentialId,
          transports: toTransports(p.transports),
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    await this.redis.set(
      RedisKeys.passkeyAuthChallenge(options.challenge),
      options.challenge,
      PASSKEY_CHALLENGE_TTL_MS,
    );
    return options;
  }

  async verifyLogin(dto: PasskeyLoginVerifyDto): Promise<AuthResponseDto> {
    const response = asAuthenticationResponse(dto.response);
    const challenge = this.extractChallenge(response.response?.clientDataJSON);

    // Single use: consumed up front so the same assertion cannot be replayed.
    const expectedChallenge = await this.redis.consume(
      RedisKeys.passkeyAuthChallenge(challenge),
    );
    if (!expectedChallenge) {
      throw new BadRequestException(
        'Passkey login session has expired or is invalid. Please restart login.',
      );
    }

    const passkey = await this.prisma.passkey.findUnique({
      where: { credentialId: response.id },
      include: { user: { include: userWithPermissionsInclude } },
    });
    if (!passkey || !UsersService.isUsable(passkey.user)) {
      throw new UnauthorizedException('Unrecognized or deactivated passkey.');
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: this.expectedOrigins,
        expectedRPID: this.rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: passkey.publicKey,
          counter: Number(passkey.counter),
          transports: toTransports(passkey.transports),
        },
        requireUserVerification: true,
      });
    } catch (err) {
      this.logger.warn(
        `[PASSKEY] Login verification failed for passkey ${passkey.id}: ${(err as Error).message}`,
      );
      throw new UnauthorizedException('Passkey authentication failed.');
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Passkey authentication failed.');
    }

    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    return this.tokens.buildAuthResponse(passkey.user);
  }

  listUserPasskeys(userId: string): Promise<PasskeySummaryDto[]> {
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

  async deleteUserPasskey(
    userId: string,
    passkeyId: string,
  ): Promise<MessageResponseDto> {
    const { count } = await this.prisma.passkey.deleteMany({
      where: { id: passkeyId, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Passkey device not found.');
    }
    return { message: 'Passkey deleted successfully.' };
  }

  private extractChallenge(clientDataJSON: string | undefined): string {
    if (clientDataJSON) {
      try {
        const clientData = JSON.parse(
          Buffer.from(clientDataJSON, 'base64url').toString('utf-8'),
        ) as {
          challenge?: unknown;
        };
        if (typeof clientData.challenge === 'string' && clientData.challenge) {
          return clientData.challenge;
        }
      } catch {
        // Fall through to the error below.
      }
    }
    throw new BadRequestException(
      'Could not parse challenge from passkey assertion.',
    );
  }
}
