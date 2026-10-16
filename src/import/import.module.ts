import { Module } from '@nestjs/common';
import { ImportService } from './import.service.js';
import { ImportController } from './import.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ClamavService } from './clamAv.service.js';
import { GraphService } from './graphApi.service.js';
import { DatabaseService } from '../database/database.service.js';
import { JwtService } from '@nestjs/jwt';

@Module({
  controllers: [ImportController],
  providers: [ImportService, ClamavService, GraphService, DatabaseService, JwtService],
  imports: [AuthModule]
})
export class ImportModule {}
