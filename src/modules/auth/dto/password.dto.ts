import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// bcrypt only uses the first 72 bytes of a password.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;

export class ChangePasswordDto {
  @ApiProperty({ example: 'CurrentPassword123!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    example: 'NewSecretPassword123!',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `New password must be at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254)
  email!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'resetToken returned by verify-otp' })
  @IsUUID()
  token!: string;

  @ApiProperty({
    example: 'BrandNewPassword123!',
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(PASSWORD_MIN, {
    message: `New password must be at least ${PASSWORD_MIN} characters`,
  })
  @MaxLength(PASSWORD_MAX)
  newPassword!: string;
}
