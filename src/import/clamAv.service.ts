import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import NodeClam from 'clamscan';
import { Readable } from 'stream';

@Injectable()
export class ClamavService implements OnModuleInit {
  private clam: any;

  async onModuleInit() {
    this.clam = await new NodeClam().init({
      preference: 'clamdscan',
      clamdscan: {
        host: process.env.CLAMAV_HOST ?? 'localhost',
        port: Number(process.env.CLAMAV_PORT ?? 3310),
        timeout: 60000,
        localFallback: false,
      },
    });
  }

  async assertClean(buffer: Buffer): Promise<void> {
    let result: { isInfected: boolean | null };
    try {
      result = await this.clam.scanStream(Readable.from(buffer));
    } catch {
      throw new ServiceUnavailableException(
        'Virus scanner unavailable, try again shortly',
      );
    }
    if (result.isInfected) {
      throw new BadRequestException('File failed the virus scan');
    }
  }
}