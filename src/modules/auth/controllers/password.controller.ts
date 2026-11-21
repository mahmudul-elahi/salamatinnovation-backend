import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../../common/decorators/public.decorator.js';
import {
  CurrentUser,
  type RequestUser,
} from '../../../common/decorators/current-user.decorator.js';
import { AUTH_THROTTLE } from '../auth.constants.js';
import { PasswordService } from '../services/password.service.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from '../dto/password.dto.js';
import {
  ChangePasswordResponseDto,
  MessageResponseDto,
  OtpRequestedDto,
  OtpVerifiedDto,
} from '../dto/auth-response.dto.js';

@ApiTags('Authentication')
@Controller('auth')
export class PasswordController {
  constructor(private readonly passwordService: PasswordService) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a 6-digit OTP code to reset password',
    description:
      'Sends a 6-digit OTP valid for 10 minutes to the email, if it is registered.',
  })
  @ApiOkResponse({ type: OtpRequestedDto })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordService.forgotPassword(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify 6-digit OTP code',
    description: 'Returns a single-use resetToken valid for 15 minutes.',
  })
  @ApiOkResponse({ type: OtpVerifiedDto })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.passwordService.verifyOtp(dto);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password using verified resetToken',
    description: 'Updates the password and signs out every existing session.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordService.resetPassword(dto);
  }

  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password for currently authenticated user',
    description:
      'Signs out every other session and returns a fresh token pair for this one.',
  })
  @ApiOkResponse({ type: ChangePasswordResponseDto })
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.passwordService.changePassword(user.id, user.sessionId, dto);
  }
}
