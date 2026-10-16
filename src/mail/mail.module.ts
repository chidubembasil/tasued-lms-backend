import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';
import { MailController } from './mail.controller.js';

@Module({
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService]
})
export class MailModule {}
