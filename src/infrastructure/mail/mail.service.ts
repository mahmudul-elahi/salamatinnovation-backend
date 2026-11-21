import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  MAIL_QUEUE,
  MailJob,
  type PasswordResetOtpJob,
} from './mail.constants.js';

/**
 * Enqueues outgoing email. Delivery happens in `MailProcessor`, off the
 * request path, with retries.
 */
@Injectable()
export class MailService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue) {}

  async sendPasswordResetOtp(job: PasswordResetOtpJob): Promise<void> {
    await this.queue.add(MailJob.PasswordResetOtp, job, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      // The payload contains an OTP: do not keep it in Redis longer than needed.
      removeOnComplete: true,
      removeOnFail: { age: 3_600 },
    });
  }
}
