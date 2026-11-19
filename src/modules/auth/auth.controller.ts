import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  PasskeyLoginOptionsDto,
  PasskeyLoginVerifyDto,
  PasskeyRegisterVerifyDto,
  RefreshTokenDto,
  ResetPasswordDto,
  VerifyOtpDto,
} from './dto/auth.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Returns JWT access token and user info.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials or inactive account.',
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT access token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully.',
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshToken(dto.refreshToken);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a 6-digit OTP code to reset password',
    description:
      'Generates a secure 6-digit OTP valid for 10 minutes and sends it to the user email.',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP code generated and dispatched to email.',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify 6-digit OTP code',
    description:
      'Validates the OTP code sent to user email. Returns a resetToken valid for 15 minutes upon success.',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified. Returns resetToken.',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password using verified resetToken',
    description:
      'Updates the user password and immediately invalidates the resetToken.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully.',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password for currently authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully.',
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(userId, dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({
    status: 200,
    description: 'Returns profile of current user with role and permissions.',
  })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.id);
  }

  // ==========================================
  // Passkey / WebAuthn Biometric Endpoints
  // ==========================================

  @Post('passkey/register/options')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate WebAuthn registration options for current user',
    description:
      'Returns challenge and registration options to pass to navigator.credentials.create() on the client.',
  })
  @ApiResponse({
    status: 200,
    description: 'Registration options generated successfully.',
  })
  async getPasskeyRegistrationOptions(@CurrentUser('id') userId: string) {
    return this.authService.generatePasskeyRegistrationOptions(userId);
  }

  @Post('passkey/register/verify')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify and save new biometric passkey credentials',
    description:
      'Verifies the cryptographic signature from client navigator.credentials.create() and registers the passkey.',
  })
  @ApiResponse({
    status: 200,
    description: 'Passkey registered successfully.',
  })
  async verifyPasskeyRegistration(
    @CurrentUser('id') userId: string,
    @Body() dto: PasskeyRegisterVerifyDto,
  ) {
    return this.authService.verifyPasskeyRegistration(userId, dto);
  }

  @Public()
  @Post('passkey/login/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate WebAuthn authentication options for passkey login',
    description:
      'Returns challenge and options for navigator.credentials.get(). Supports both autofill/1-click passkeys and targeted email login.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication options generated successfully.',
  })
  async getPasskeyLoginOptions(@Body() dto?: PasskeyLoginOptionsDto) {
    return this.authService.generatePasskeyLoginOptions(dto);
  }

  @Public()
  @Post('passkey/login/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify biometric passkey response and log in user',
    description:
      'Validates the biometric signature assertion and returns standard JWT tokens (accessToken, refreshToken, user).',
  })
  @ApiResponse({
    status: 200,
    description: 'Biometric authentication successful. Returns JWT tokens.',
  })
  async verifyPasskeyLogin(@Body() dto: PasskeyLoginVerifyDto) {
    return this.authService.verifyPasskeyLogin(dto);
  }

  @Get('passkeys')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all registered biometric passkeys for current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns list of user passkeys.',
  })
  async listPasskeys(@CurrentUser('id') userId: string) {
    return this.authService.listUserPasskeys(userId);
  }

  @Delete('passkeys/:id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke and delete a registered passkey' })
  @ApiParam({ name: 'id', description: 'Passkey ID' })
  @ApiResponse({
    status: 200,
    description: 'Passkey deleted successfully.',
  })
  async deletePasskey(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.authService.deleteUserPasskey(userId, id);
  }
}
