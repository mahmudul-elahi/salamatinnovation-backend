import type { PasswordResetOtpJob } from '../mail.constants.js';
import { escapeHtml } from './escape-html.js';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export function renderPasswordResetOtp(job: PasswordResetOtpJob): RenderedMail {
  const greeting = job.firstName ? `Hello ${job.firstName},` : 'Hello,';
  const safeGreeting = escapeHtml(greeting);
  const safeOtp = escapeHtml(job.otp);

  const text = [
    greeting,
    '',
    `Your password reset OTP code is: ${job.otp}`,
    '',
    `This code will expire in ${job.expiresInMinutes} minutes. If you did not request a password reset, please ignore this email.`,
    '',
    'Salamat Innovation POS & ERP',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 6px;">
      <h2 style="color: #1a1a1a; margin-top: 0;">Password Reset Request</h2>
      <p style="color: #4a4a4a; font-size: 15px;">${safeGreeting}</p>
      <p style="color: #4a4a4a; font-size: 15px;">You have requested to reset your account password. Use the following 6-digit One-Time Password (OTP) to complete the reset:</p>
      <div style="background-color: #f4f6f8; padding: 15px; text-align: center; border-radius: 6px; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${safeOtp}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">This code will expire in <strong>${job.expiresInMinutes} minutes</strong>. If you did not request this code, no action is needed and your account remains safe.</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
      <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Salamat Innovation POS & ERP Platform</p>
    </div>
  `;

  return {
    subject: 'Your Password Reset OTP - Salamat POS & ERP',
    text,
    html,
  };
}
