/** TTLs (milliseconds) and limits for the auth flows. */
export const OTP_TTL_MS = 10 * 60_000;
export const OTP_COOLDOWN_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_MS = 15 * 60_000;
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60_000;

/** Rate limit for sensitive, unauthenticated auth endpoints (per client IP). */
export const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

export const RedisKeys = {
  otp: (email: string) => `otp:${email}`,
  otpAttempts: (email: string) => `otp_attempts:${email}`,
  otpCooldown: (email: string) => `otp_cooldown:${email}`,
  resetToken: (token: string) => `reset_token:${token}`,
  refreshToken: (jti: string) => `refresh_token:${jti}`,
  passkeyRegistrationChallenge: (userId: string) =>
    `passkey_reg_challenge:${userId}`,
  passkeyAuthChallenge: (challenge: string) =>
    `passkey_auth_challenge:${challenge}`,
};
