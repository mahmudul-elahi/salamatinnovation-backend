import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly from: string;

  constructor(configService: ConfigService) {
    const host = configService.get<string>('mail.host', '');
    const port = configService.get<number>('mail.port', 587);
    const user = configService.get<string>('mail.user', '');
    const pass = configService.get<string>('mail.pass', '');
    this.from = configService.get<string>(
      'mail.from',
      '"Salamat POS & ERP" <no-reply@salamatinnovation.com>',
    );

    if (host && user) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`[MAIL] SMTP transport initialized for host: ${host}`);
    } else {
      this.logger.log(
        '[MAIL] No SMTP credentials configured. Emails will be logged to console in development mode.',
      );
    }
  }

  async sendPasswordResetOtp(
    email: string,
    otp: string,
    firstName?: string,
  ): Promise<void> {
    const greeting = firstName ? `Hello ${firstName},` : 'Hello,';
    const textContent = `${greeting}\n\nYour password reset OTP code is: ${otp}\n\nThis code will expire in 10 minutes. If you did not request a password reset, please ignore this email.\n\nSalamat Innovation POS & ERP`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 6px;">
        <h2 style="color: #1a1a1a; margin-top: 0;">Password Reset Request</h2>
        <p style="color: #4a4a4a; font-size: 15px;">${greeting}</p>
        <p style="color: #4a4a4a; font-size: 15px;">You have requested to reset your account password. Use the following 6-digit One-Time Password (OTP) to complete the reset:</p>
        <div style="background-color: #f4f6f8; padding: 15px; text-align: center; border-radius: 6px; margin: 24px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0f172a;">${otp}</span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This code will expire in <strong>10 minutes</strong>. If you did not request this code, no action is needed and your account remains safe.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">Salamat Innovation POS & ERP Platform</p>
      </div>
    `;

    console.log(
      `[MAIL] ========================================================`,
    );
    console.log(`[MAIL] Password Reset OTP for: ${email}`);
    console.log(`[MAIL] OTP Code: ${otp}`);
    console.log(`[MAIL] Expires in: 10 minutes`);
    console.log(
      `[MAIL] ========================================================`,
    );

    if (this.transporter) {
      try {
        await this.transporter.sendMail({
          from: this.from,
          to: email,
          subject: 'Your Password Reset OTP - Salamat POS & ERP',
          text: textContent,
          html: htmlContent,
        });
        this.logger.log(`[MAIL] OTP email successfully sent to: ${email}`);
      } catch (err: any) {
        this.logger.error(
          `[MAIL] Failed to send email to ${email}: ${err.message}`,
        );
      }
    }
  }
}
