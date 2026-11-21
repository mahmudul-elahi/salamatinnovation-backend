import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import {
  Client,
  type ClientInfo,
} from '../../../common/decorators/client-info.decorator.js';
import { AUTH_THROTTLE } from '../auth.constants.js';
import { PasskeyService } from '../services/passkey.service.js';
import {
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRegisterVerifyDto,
} from '../dto/passkey.dto.js';
import {
  AuthResponseDto,
  MessageResponseDto,
  PasskeyRegisteredDto,
  PasskeySummaryDto,
} from '../dto/auth-response.dto.js';

@ApiTags('Passkeys')
@Controller('auth')
export class PasskeyController {
  constructor(private readonly passkeyService: PasskeyService) {}

  @Post('passkey/register/options')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate WebAuthn registration options for current user',
    description:
      'Pass the result to navigator.credentials.create() on the client.',
  })
  getRegistrationOptions(@CurrentUser('id') userId: string) {
    return this.passkeyService.generateRegistrationOptions(userId);
  }

  @Post('passkey/register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify and save a new passkey credential' })
  @ApiOkResponse({ type: PasskeyRegisteredDto })
  verifyRegistration(
    @CurrentUser('id') userId: string,
    @Body() dto: PasskeyRegisterVerifyDto,
  ) {
    return this.passkeyService.verifyRegistration(userId, dto);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('passkey/login/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate WebAuthn authentication options for passkey login',
    description:
      'Pass the result to navigator.credentials.get(). Email is optional (autofill / 1-click).',
  })
  getLoginOptions(@Body() dto: PasskeyLoginOptionsDto) {
    return this.passkeyService.generateLoginOptions(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('passkey/login/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a passkey assertion and log in' })
  @ApiOkResponse({ type: AuthResponseDto })
  verifyLogin(
    @Body() dto: PasskeyLoginVerifyDto,
    @Client() client: ClientInfo,
  ) {
    return this.passkeyService.verifyLogin(dto, client);
  }

  @Get('passkeys')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List registered passkeys of the current user' })
  @ApiOkResponse({ type: [PasskeySummaryDto] })
  list(@CurrentUser('id') userId: string) {
    return this.passkeyService.listUserPasskeys(userId);
  }

  @Delete('passkeys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke and delete a registered passkey' })
  @ApiParam({ name: 'id', description: 'Passkey ID' })
  @ApiOkResponse({ type: MessageResponseDto })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.passkeyService.deleteUserPasskey(userId, id);
  }
}
