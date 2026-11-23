export const MAIL_QUEUE = 'mail';

export const MailJob = {
  PasswordResetOtp: 'password-reset-otp',
} as const;

export interface PasswordResetOtpJob {
  email: string;
  otp: string;
  firstName?: string;
  expiresInMinutes: number;
}
