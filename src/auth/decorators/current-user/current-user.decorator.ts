import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, AuthUser } from '../../../types/auth-user.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);