import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import {
  MAIL_QUEUE,
  MailJob,
  type PasswordResetOtpJob,
} from './mail.constants.js';
import { MailTransportService } from './mail-transport.service.js';
import { renderPasswordResetOtp } from './templates/password-reset-otp.template.js';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly transport: MailTransportService) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case MailJob.PasswordResetOtp: {
        const data = job.data as PasswordResetOtpJob;
        await this.transport.send(data.email, renderPasswordResetOtp(data));
        return;
      }
      default:
        throw new Error(`Unknown mail job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(
      `[MAIL] Job ${job?.name ?? 'unknown'} (${job?.id ?? '-'}) failed after ${job?.attemptsMade ?? 0} attempt(s): ${error.message}`,
    );
  }
}
