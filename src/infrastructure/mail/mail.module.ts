import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MAIL_QUEUE } from './mail.constants.js';
import { MailService } from './mail.service.js';
import { MailTransportService } from './mail-transport.service.js';
import { MailProcessor } from './mail.processor.js';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [MailService, MailTransportService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
