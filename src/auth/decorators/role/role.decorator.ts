import { SetMetadata } from '@nestjs/common';

export type AppRole = 'ADMIN' | 'LECTURER' | 'TEACHER_ASSISTANT' | 'STUDENT';

export const ROLES_KEY = 'roles';

// @Roles('ADMIN')  or  @Roles('LECTURER', 'HOD', 'ADMIN')
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);