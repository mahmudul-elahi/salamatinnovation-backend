import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { LoginMethod, SessionEndReason } from '@prisma/client';
import { PaginationDto } from '../../../common/pagination/pagination.dto.js';

export class SessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'True for the session making this request' })
  current!: boolean;

  @ApiProperty({ enum: ['active', 'expired', 'revoked'] })
  status!: 'active' | 'expired' | 'revoked';

  @ApiProperty({ enum: LoginMethod, enumName: 'LoginMethod' })
  loginMethod!: LoginMethod;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Chrome on Windows',
  })
  deviceName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  userAgent!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '203.0.113.7' })
  ipAddress!: string | null;

  @ApiProperty({ description: 'When the user logged in' })
  createdAt!: Date;

  @ApiProperty({ description: 'Accurate to within about a minute' })
  lastActiveAt!: Date;

  @ApiProperty({ description: 'Ends here unless refreshed before then' })
  expiresAt!: Date;

  @ApiPropertyOptional({ type: Date, nullable: true })
  revokedAt!: Date | null;

  @ApiPropertyOptional({
    enum: SessionEndReason,
    enumName: 'SessionEndReason',
    nullable: true,
  })
  revokedReason!: SessionEndReason | null;
}

export class SessionHistoryQueryDto extends PickType(PaginationDto, [
  'page',
  'limit',
] as const) {}

class PaginationMetaDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
  @ApiProperty() hasNextPage!: boolean;
  @ApiProperty() hasPrevPage!: boolean;
}

export class SessionHistoryDto {
  @ApiProperty({ type: [SessionDto] })
  items!: SessionDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class SessionsRevokedDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 2 })
  revokedCount!: number;
}
