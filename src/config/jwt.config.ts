import { registerAs } from '@nestjs/config';

export const jwtConfig = registerAs('jwt', () => ({
  secret:
    process.env.JWT_SECRET ||
    'salamatinnovation-backend-super-secret-jwt-key-2026',
  expiresIn: process.env.JWT_EXPIRES_IN || '1d',
}));
