import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SessionEndReason } from '@prisma/client';
import {
  CurrentUser,
  type RequestUser,
} from '../../../common/decorators/current-user.decorator.js';
import { MessageResponseDto } from '../dto/auth-response.dto.js';
import {
  SessionDto,
  SessionHistoryDto,
  SessionHistoryQueryDto,
  SessionsRevokedDto,
} from '../dto/session.dto.js';
import { SessionService } from '../services/session.service.js';

@ApiTags('Sessions')
@ApiBearerAuth()
@Controller('auth/sessions')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Get()
  @ApiOperation({
    summary: 'List the devices currently signed in to this account',
    description:
      'Most recently active first. The session making this request has `current: true`.',
  })
  @ApiOkResponse({ type: [SessionDto] })
  listActive(@CurrentUser() user: RequestUser) {
    return this.sessions.listActive(user.id, user.sessionId);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Login history: every session, including ended ones',
    description:
      'Newest first. Ended sessions are kept for 90 days. `status` and `revokedReason` say how each one ended.',
  })
  @ApiOkResponse({ type: SessionHistoryDto })
  history(
    @CurrentUser() user: RequestUser,
    @Query() query: SessionHistoryQueryDto,
  ) {
    return this.sessions.history(
      user.id,
      query.page,
      query.limit,
      user.sessionId,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out one session',
    description:
      'That device is rejected on its next request. Ending your own current session logs you out.',
  })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiNotFoundResponse({ description: 'No active session with this ID.' })
  async revoke(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MessageResponseDto> {
    const reason =
      id === user.sessionId
        ? SessionEndReason.LOGOUT
        : SessionEndReason.SIGNED_OUT_REMOTELY;
    if (!(await this.sessions.revoke(user.id, id, reason))) {
      throw new NotFoundException('No active session with this ID.');
    }
    return { message: 'Session signed out.' };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign out every other session',
    description:
      'Keeps the session making this request. To include it, use POST /auth/logout-all.',
  })
  @ApiOkResponse({ type: SessionsRevokedDto })
  async revokeOthers(
    @CurrentUser() user: RequestUser,
  ): Promise<SessionsRevokedDto> {
    const revokedCount = await this.sessions.revokeAll(
      user.id,
      SessionEndReason.SIGNED_OUT_REMOTELY,
      user.sessionId,
    );
    return {
      message:
        revokedCount === 0
          ? 'No other sessions were signed in.'
          : 'All other sessions have been signed out.',
      revokedCount,
    };
  }
}
