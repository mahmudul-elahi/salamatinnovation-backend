import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  email!: string;

  @ApiProperty({ example: 'Admin@123456', minLength: 6 })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ example: 'jwt-refresh-token' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'CurrentPassword123!' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'NewSecretPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'reset-token-string' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'BrandNewPassword123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters' })
  newPassword!: string;
}

export class PasskeyRegisterVerifyDto {
  @ApiProperty({
    description:
      'Registration response JSON from navigator.credentials.create()',
  })
  @IsNotEmpty()
  response!: any;

  @ApiPropertyOptional({
    example: 'MacBook Touch ID',
    description: 'Friendly name for the passkey device',
  })
  @IsOptional()
  @IsString()
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
    description:
      'Authentication response JSON from navigator.credentials.get()',
  })
  @IsNotEmpty()
  response!: any;

  @ApiPropertyOptional({ example: 'admin@salamatinnovation.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email?: string;
}
