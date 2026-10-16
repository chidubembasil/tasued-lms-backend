import type { Request } from 'express';

export type AuthKind = 'USER' | 'ADMIN';

// what AuthService.issueTokens puts inside the access token
export interface AccessPayload {
  sub: string;
  email: string;
  role: AuthKind;
  sid: string;
  iat?: number;
  exp?: number;
}

// what controllers receive through @CurrentUser()
export interface AuthUser {
  id: string;
  email: string;
  kind: AuthKind;
  sessionId: string;
  role?: string; // academic role (STUDENT, LECTURER, ...), set by RolesGuard for non-admins
}

export interface AuthedRequest extends Request {
  user: AuthUser;
}