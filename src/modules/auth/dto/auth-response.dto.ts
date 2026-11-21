import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MessageResponseDto {
  @ApiProperty()
  message!: string;
}

export class RoleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Administrator' })
  name!: string;

  @ApiProperty({ example: 'admin' })
  slug!: string;
}

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone?: string | null;

  @ApiProperty({ type: RoleSummaryDto })
  role!: RoleSummaryDto;

  @ApiProperty({ type: [String], example: ['users:read'] })
  permissions!: string[];
}

export class ProfileDto extends AuthUserDto {
  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class TokenPairDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty({
    description: 'Single-use: each refresh returns a new refresh token',
  })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType!: 'Bearer';
}

export class AuthResponseDto extends TokenPairDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto;
}

export class ChangePasswordResponseDto extends AuthResponseDto {
  @ApiProperty()
  message!: string;
}

export class OtpRequestedDto extends MessageResponseDto {
  @ApiProperty({ example: 600 })
  expiresInSeconds!: number;
}

export class OtpVerifiedDto extends MessageResponseDto {
  @ApiProperty({
    description: 'Pass to reset-password; valid for 15 minutes, single use',
  })
  resetToken!: string;
}

export class PasskeySummaryDto {
  @ApiProperty()
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  name!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  deviceType!: string | null;

  @ApiProperty()
  backedUp!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  lastUsedAt!: Date | null;
}

export class PasskeyRegisteredDto extends MessageResponseDto {
  @ApiProperty({ type: PasskeySummaryDto })
  passkey!: Pick<PasskeySummaryDto, 'id' | 'name' | 'deviceType' | 'createdAt'>;
}
