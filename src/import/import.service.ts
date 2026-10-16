import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { DatabaseService } from '../database/database.service.js';
import {
  AuthService,
  ProvisionRole,
  ProvisionUserInput,
} from '../auth/auth.service.js';
import { ClamavService } from './clamAv.service.js';
import { GraphService } from './graphApi.service.js';
const REQUIRED = ['email', 'firstName', 'lastName'];
const ROLES: ProvisionRole[] = ['STUDENT', 'LECTURER', 'TEACHER_ASSISTANT'];

// accepts: student, lecturer, teacherAssistant, "teacher assistant", teacher_assistant, TA
const normalizeRole = (value?: string): string => {
  const key = (value ?? '').toUpperCase().replace(/[\s_-]/g, '');
  if (!key) return 'STUDENT';
  if (key === 'TEACHERASSISTANT' || key === 'TA') return 'TEACHER_ASSISTANT';
  return key; // anything else is rejected for that row in importRow
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type UploadedCsv = { originalname: string; buffer: Buffer };

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    private readonly clamav: ClamavService,
    private readonly graph: GraphService,
  ) {}

  async start(file: UploadedCsv | undefined, adminId: string) {
    if (!file) throw new BadRequestException('CSV file is required');

    await this.clamav.assertClean(file.buffer); // 1. scan before anything reads it
    const rows = this.parse(file.buffer); // 2. structural validation

    const job = await this.database.importJob.create({
      data: {
        uploadedBy: adminId,
        fileName: file.originalname,
        total: rows.length,
      },
    });

    void this.process(job.id, rows).catch((e) =>
      this.logger.error(`Import ${job.id} crashed`, e),
    );

    return { jobId: job.id, total: rows.length };
  }

  async status(id: string) {
    const job = await this.database.importJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Import not found');
    return job;
  }

  private parse(buffer: Buffer): ProvisionUserInput[] {
    const records: Record<string, string>[] = parse(buffer, {
      columns: true,
      bom: true,
      trim: true,
      skip_empty_lines: true,
    });
    if (!records.length) throw new BadRequestException('CSV has no rows');

    const missing = REQUIRED.filter((c) => !(c in records[0]));
    if (missing.length) {
      throw new BadRequestException(`Missing columns: ${missing.join(', ')}`);
    }

    return records.map((r) => ({
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      role: normalizeRole(r.role) as ProvisionRole,
      matricNumber: r.matricNumber || undefined,
      staffId: r.staffId || undefined,
    }));
  }

  private async process(jobId: string, rows: ProvisionUserInput[]) {
    const errors: { row: number; email: string; error: string }[] = [];
    let succeeded = 0;
    const BATCH = 5; // keeps Graph throttling manageable

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map((r) => this.importRow(r)),
      );
      results.forEach((res, j) => {
        if (res.status === 'fulfilled') succeeded++;
        else {
          errors.push({
            row: i + j + 2, // +1 for the header line, +1 for 1-based rows
            email: batch[j].email,
            error: res.reason?.message ?? 'Unknown error',
          });
        }
      });
    }

    await this.database.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        succeeded,
        failed: errors.length,
        errors: errors.length ? errors : undefined,
        finishedAt: new Date(),
      },
    });
  }

  private async importRow(r: ProvisionUserInput) {
    if (!EMAIL_RE.test(r.email)) throw new Error('Invalid email');
    if (!r.firstName || !r.lastName) throw new Error('Missing name');
    if (!ROLES.includes(r.role)) throw new Error(`Invalid role: ${r.role}`);

    const user = await this.auth.provisionUser(r);

    if (!user.guestObjectId) {
      try {
        const { guestObjectId } = await this.graph.inviteGuest(
          user.email,
          user.name,
        );
        await this.database.user.update({
          where: { id: user.id },
          data: { guestObjectId, invitationStatus: 'INVITED' },
        });
      } catch (e) {
        await this.database.user.update({
          where: { id: user.id },
          data: { invitationStatus: 'FAILED' },
        });
        throw e;
      }
    }
  }
}