import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../../../database/database.service.js';
import { AppRole, ROLES_KEY } from '../../decorators/role/role.decorator.js';
import type { AuthedRequest } from '../../../types/auth-user.js';

// Always use after AuthGuard:  @UseGuards(AuthGuard, RolesGuard)
// A route with no @Roles() only needs a signed-in user.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Not signed in');
    }

    // admins are a separate account type: they only pass routes that list 'ADMIN'
    if (user.kind === 'ADMIN') {
      if (required.includes('ADMIN')) {
        return true;
      }
      throw new ForbiddenException('You do not have permission to do this');
    }

    // academic role is read from the database each time, so role changes apply immediately
    const record = await this.database.role.findUnique({
      where: { userId: user.id },
      select: { role: true },
    });

    if (record?.role && (required as string[]).includes(record.role)) {
      request.user.role = record.role;
      return true;
    }

    throw new ForbiddenException('You do not have permission to do this');
  }
}