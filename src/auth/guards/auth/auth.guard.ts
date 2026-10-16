import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../auth.service.js';
import type { AccessPayload, AuthedRequest } from '../../../types/auth-user.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();

    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: AccessPayload;

    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload.sid || !payload.sub) {
      throw new UnauthorizedException('Invalid access token');
    }

    // logout, password change and reuse detection take effect immediately
    const active = await this.auth.isSessionActive(payload.sid, payload.role);

    if (!active) {
      throw new UnauthorizedException('Session ended, please sign in again');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
      kind: payload.role,
      sessionId: payload.sid,
    };

    return true;
  }
}