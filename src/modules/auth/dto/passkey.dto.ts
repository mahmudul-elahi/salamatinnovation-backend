import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';

/**
 * Shape check for the credential JSON produced by the browser's WebAuthn API.
 * The inner `response` object is validated cryptographically by
 * @simplewebauthn/server, so it is only checked for being an object here.
 */
class WebAuthnCredentialDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  rawId!: string;

  @ApiProperty({ enum: ['public-key'] })
  @IsIn(['public-key'])
  type!: 'public-key';

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  response!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @IsObject()
  clientExtensionResults!: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['platform', 'cross-platform'] })
  @IsOptional()
  @IsIn(['platform', 'cross-platform'])
  authenticatorAttachment?: 'platform' | 'cross-platform';
}

export class PasskeyRegisterVerifyDto {
  @ApiProperty({
    type: WebAuthnCredentialDto,
    description:
      'Registration response JSON from navigator.credentials.create()',
  })
  @ValidateNested()
  @Type(() => WebAuthnCredentialDto)
  response!: WebAuthnCredentialDto;

  @ApiPropertyOptional({
    example: 'MacBook Touch ID',
    description: 'Friendly name for the passkey device',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class PasskeyLoginOptionsDto {
  @ApiPropertyOptional({
    example: 'admin@salamatinnovation.com',
    description: 'Optional email for targeted passkey login',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;
}

export class PasskeyLoginVerifyDto {
  @ApiProperty({
    type: WebAuthnCredentialDto,
    description:
      'Authentication response JSON from navigator.credentials.get()',
  })
  @ValidateNested()
  @Type(() => WebAuthnCredentialDto)
  response!: WebAuthnCredentialDto;

  @ApiPropertyOptional({
    example: 'admin@salamatinnovation.com',
    description:
      'Accepted for client compatibility; the credential identifies the user.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;
}

export const asRegistrationResponse = (dto: WebAuthnCredentialDto) =>
  dto as unknown as RegistrationResponseJSON;

export const asAuthenticationResponse = (dto: WebAuthnCredentialDto) =>
  dto as unknown as AuthenticationResponseJSON;
