import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsJWT,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@salamatinnovation.com' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Admin@123456' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token returned by login or a previous refresh',
  })
  @IsJWT()
  refreshToken!: string;
}
