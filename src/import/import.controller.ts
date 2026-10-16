import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ImportService, type UploadedCsv } from './import.service.js';
import { AuthGuard } from '../auth/guards/auth/auth.guard.js';
import { RolesGuard } from '../auth/guards/role/role.guard.js';
import { Roles } from '../auth/decorators/role/role.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator.js';
import type { AuthUser } from '../types/auth-user.js';

@ApiTags('Imports')
@ApiBearerAuth()
@Controller('imports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // No storage option is set, so multer keeps the file in memory only and nothing is written to disk.
  @ApiOperation({
    summary: 'Import users from a CSV (admin only)',
    description:
      'Columns: email, firstName, lastName (required); role, matricNumber, staffId (optional). Returns a job id to poll.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @Post('users')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
      fileFilter: (
        _req: unknown,
        file: { originalname: string },
        callback: (error: Error | null, acceptFile: boolean) => void,
      ) => {
        const isCsv = file.originalname.toLowerCase().endsWith('.csv');
        callback(
          isCsv ? null : new BadRequestException('Only .csv files are accepted'),
          isCsv,
        );
      },
    }),
  )
  upload(
    @UploadedFile() file: UploadedCsv | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.imports.start(file, user.id);
  }

  @ApiOperation({ summary: 'Check the progress and errors of an import job' })
  @Get(':id')
  status(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.status(id);
  }
}