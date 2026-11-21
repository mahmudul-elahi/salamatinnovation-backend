import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import type { Env } from '../../config/env.schema.js';
import type { RenderedMail } from './templates/password-reset-otp.template.js';

/**
 * Low-level SMTP delivery. Only the mail queue worker calls this; request
 * handlers enqueue through `MailService` instead.
 */
@Injectable()
export class MailTransportService {
  private readonly logger = new Logger(MailTransportService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService<Env, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true });
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });
    this.isProduction =
      config.get('NODE_ENV', { infer: true }) === 'production';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        ...(user ? { auth: { user, pass } } : {}),
      });
      this.logger.log(`[MAIL] SMTP transport initialized for host: ${host}`);
    } else {
      this.transporter = null;
      if (this.isProduction) {
        this.logger.error(
          '[MAIL] SMTP_HOST is not configured; emails cannot be delivered.',
        );
      } else {
        this.logger.warn(
          '[MAIL] No SMTP host configured. Emails will be printed to the console.',
        );
      }
    }
  }

  /** Throws on delivery failure so the queue can retry the job. */
  async send(to: string, mail: RenderedMail): Promise<void> {
    if (!this.transporter) {
      if (this.isProduction) {
        throw new Error('SMTP transport is not configured');
      }
      // Development only: no SMTP configured, so show the message locally.
      this.logger.log(
        `[MAIL] (console delivery) To: ${to} | Subject: ${mail.subject}\n${mail.text}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    this.logger.log(`[MAIL] Sent "${mail.subject}" to ${to}`);
  }
}
