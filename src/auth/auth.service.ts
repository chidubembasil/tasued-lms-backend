import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { SignUpDto } from './dto/signup_dto.js';
import { SignInDto } from './dto/signIn_dto.js';
import { LogoutDto } from './dto/logout_dto.js';
import { RefreshDto } from './dto/refresh_dto.js';
import { ChangePasswordDto } from './dto/changePassword_dto.js';
import { ForgotPasswordDto } from './dto/forgotPassword_dto.js';
import { ResetPasswordDto } from './dto/resetPassword_dto.js';
import { MailService } from '../mail/mail.service.js';
import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from 'crypto';

export type ProvisionRole = 'STUDENT' | 'LECTURER' | 'TEACHER_ASSISTANT';

export type ProvisionUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  role: ProvisionRole;
  matricNumber?: string;
  staffId?: string;
};

const ACCESS_TTL_SEC = 15 * 60; // access token: 15 minutes
const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000; // refresh token: 14 days
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_TTL_MS = 10 * 60 * 1000;
const BCRYPT_ROUNDS = 12;

// compared against when the email does not exist, so response time does not reveal accounts
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer', BCRYPT_ROUNDS);

type TokenKind = 'USER' | 'ADMIN';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  // =========================================================
  // HELPERS
  // =========================================================

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private invalidCredentials() {
    return new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
  }

  private invalidSession() {
    return new HttpException(
      'Session expired, please sign in again',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private assertPasswordStrength(password: string) {
    if (!password || password.length < 8) {
      throw new HttpException(
        'Password must be at least 8 characters',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Builds an access token + an opaque refresh token. Only the refresh
  // token's hash is stored (in Session.tokenHash / AdminSession.tokenHash).
  private async issueTokens(
    kind: TokenKind,
    subject: { id: string; email: string },
  ) {
    const sessionId = randomUUID();
    const refreshToken = randomBytes(48).toString('base64url');

    const accessToken = await this.jwt.signAsync(
      {
        sub: subject.id,
        email: subject.email,
        role: kind,
        sid: sessionId,
      },
      { expiresIn: ACCESS_TTL_SEC },
    );

    return {
      sessionId,
      accessToken,
      refreshToken,
      tokenHash: this.sha256(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    };
  }

  // For your JWT guard: call with payload.sid so logout / revoke takes effect immediately.
  async isSessionActive(sessionId: string, kind: TokenKind) {
    const where = {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    };

    const session =
      kind === 'ADMIN'
        ? await this.database.adminSession.findFirst({ where })
        : await this.database.session.findFirst({ where });

    return !!session;
  }

  // =========================================================
  // USERS
  // =========================================================

  async getAllUsers() {
    return this.database.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        matricNumber: true,
        staffId: true,
        invitationStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async getOneUser(id: string) {
    const user = await this.database.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        matricNumber: true,
        staffId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async getMe(id: string) {
    const user = await this.database.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        matricNumber: true,
        staffId: true,
        mustChangePassword: true,
        roles: { select: { role: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async signupUser(createData: SignUpDto) {
    this.assertPasswordStrength(createData.password);
    const hash = await bcrypt.hash(createData.password, BCRYPT_ROUNDS);

    const user = await this.database.user.create({
      data: {
        name: createData.name,
        email: createData.email.toLowerCase().trim(),
        password: hash,
      },
    });

    return {
      message: 'User created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  // =========================================================
  // PROVISION USER (CSV IMPORT)
  // =========================================================

  async provisionUser(dto: ProvisionUserInput) {
    const email = dto.email.toLowerCase().trim();
    // students use a matric number, lecturers a staff ID,
    // teacher assistants whichever they have (staff ID preferred)
    const useMatric =
      dto.role === 'STUDENT' ||
      (dto.role === 'TEACHER_ASSISTANT' && !dto.staffId);
    const idValue = useMatric ? dto.matricNumber : dto.staffId;

    if (!idValue) {
      throw new HttpException(
        useMatric ? 'Missing matric number' : 'Missing staff ID',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.database.user.findFirst({
      where: {
        OR: [
          { email },
          useMatric ? { matricNumber: idValue } : { staffId: idValue },
        ],
      },
    });

    if (existing) {
      if (existing.email !== email) {
        throw new HttpException(
          'Matric number / staff ID already belongs to a different email',
          HttpStatus.CONFLICT,
        );
      }
      return existing;
    }

    const tempPassword = randomBytes(9).toString('base64url');
    const hash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    const user = await this.database.user.create({
      data: {
        name: `${dto.firstName} ${dto.lastName}`.trim(),
        email,
        password: hash,
        mustChangePassword: true,
        matricNumber: useMatric ? idValue : undefined,
        staffId: useMatric ? undefined : idValue,
        roles: { create: { role: dto.role } },
      },
    });

    try {
      await this.mail.sendWelcome(user.email, user.name, tempPassword);
    } catch (error) {
      // no credentials delivered, so remove the user and let a re-run retry cleanly
      await this.database.user.delete({ where: { id: user.id } });
      throw error;
    }

    return user;
  }

  // =========================================================
  // USER LOGIN
  // =========================================================

  async loginUser(login: SignInDto) {
    const user = await this.database.user.findUnique({
      where: { email: login.email.toLowerCase().trim() },
    });

    if (!user) {
      await bcrypt.compare(login.password, DUMMY_HASH);
      throw this.invalidCredentials();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const verifyPassword = await bcrypt.compare(login.password, user.password);

    if (!verifyPassword) {
      const failedLogins = user.failedLogins + 1;
      const lock = failedLogins >= MAX_FAILED_LOGINS;

      await this.database.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failedLogins,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
        },
      });

      throw this.invalidCredentials();
    }

    if (user.failedLogins || user.lockedUntil) {
      await this.database.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }

    const tokens = await this.issueTokens('USER', user);

    await this.database.session.create({
      data: {
        id: tokens.sessionId,
        userId: user.id,
        tokenHash: tokens.tokenHash,
        lastActivityAt: new Date(),
        expiresAt: tokens.expiresAt,
      },
    });

    return {
      message: 'Login successful',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      mustChangePassword: user.mustChangePassword,
    };
  }

  // =========================================================
  // USER REFRESH (rotates the refresh token on every call)
  // =========================================================

  async refreshUser(dto: RefreshDto) {
    const old = await this.database.session.findUnique({
      where: { tokenHash: this.sha256(dto.refreshToken) },
      include: { user: true },
    });

    if (!old) {
      throw this.invalidSession();
    }

    if (old.revokedAt) {
      // an already-rotated token was used again: treat as theft and kill every session
      if (old.replacedByTokenId) {
        await this.database.session.updateMany({
          where: { userId: old.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw this.invalidSession();
    }

    if (old.expiresAt <= new Date()) {
      throw this.invalidSession();
    }

    const tokens = await this.issueTokens('USER', old.user);

    await this.database.$transaction([
      this.database.session.create({
        data: {
          id: tokens.sessionId,
          userId: old.userId,
          tokenHash: tokens.tokenHash,
          lastActivityAt: new Date(),
          expiresAt: tokens.expiresAt,
        },
      }),
      this.database.session.update({
        where: { id: old.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: tokens.sessionId,
          lastActivityAt: new Date(),
        },
      }),
    ]);

    return {
      message: 'Token refreshed',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
      mustChangePassword: old.user.mustChangePassword,
    };
  }

  // =========================================================
  // USER LOGOUT
  // =========================================================

  async logout(logoutDto: LogoutDto) {
    const session = await this.database.session.findUnique({
      where: {
        id: logoutDto.sessionId,
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.revokedAt) {
      return {
        message: 'Already logged out',
      };
    }

    await this.database.session.update({
      where: {
        id: logoutDto.sessionId,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Logged out successfully',
    };
  }

  async logoutAll(userId: string) {
    await this.database.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return {
      message: 'Logged out of all devices',
    };
  }

  // =========================================================
  // CHANGE PASSWORD (signed-in user)
  // =========================================================

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentSessionId?: string,
  ) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await bcrypt.compare(dto.currentPassword, user.password);

    if (!matches) {
      throw new HttpException(
        'Current password is incorrect',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.assertPasswordStrength(dto.newPassword);

    if (dto.currentPassword === dto.newPassword) {
      throw new HttpException(
        'New password must be different from the current one',
        HttpStatus.BAD_REQUEST,
      );
    }

    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.database.user.update({
      where: { id: userId },
      data: { password: hash, mustChangePassword: false },
    });

    // sign out every other device
    await this.database.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });

    return {
      message: 'Password changed successfully',
    };
  }

  // =========================================================
  // FORGOT / RESET PASSWORD (6-digit code by email)
  // =========================================================

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.database.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    // same response whether or not the account exists
    if (user) {
      const otp = randomInt(100000, 1000000).toString();

      await this.database.user.update({
        where: { id: user.id },
        data: {
          otpHash: this.sha256(otp),
          otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          otpAttempts: 0,
        },
      });

      await this.mail.sendOtp(user.email, otp);
    }

    return {
      message: 'If that email exists, a reset code has been sent',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.database.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (!user || !user.otpHash || !user.otpExpiresAt) {
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (new Date() > user.otpExpiresAt || user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      await this.database.user.update({
        where: { id: user.id },
        data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 },
      });
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const given = Buffer.from(this.sha256(dto.otp), 'hex');
    const stored = Buffer.from(user.otpHash, 'hex');

    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      await this.database.user.update({
        where: { id: user.id },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new HttpException(
        'Invalid or expired code',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.assertPasswordStrength(dto.newPassword);
    const hash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);

    await this.database.user.update({
      where: { id: user.id },
      data: {
        password: hash,
        mustChangePassword: false,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    await this.database.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return {
      message: 'Password reset successfully, please sign in',
    };
  }

  // =========================================================
  // DELETE USER
  // =========================================================

  async deleteUser(id: string) {
    const findUser = await this.database.user.findUnique({
      where: { id },
    });

    if (!findUser) {
      throw new NotFoundException('User not found');
    }

    await this.database.user.delete({
      where: { id },
    });

    return {
      message: 'User deleted successfully',
    };
  }

  // =========================================================
  // ADMINS
  // =========================================================

  async getAllAdmin() {
    return this.database.admin.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // =========================================================
  // ADMIN LOGIN
  // =========================================================

  async loginAdmin(login: SignInDto) {
    const admin = await this.database.admin.findUnique({
      where: { email: login.email.toLowerCase().trim() },
    });

    if (!admin) {
      await bcrypt.compare(login.password, DUMMY_HASH);
      throw this.invalidCredentials();
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new HttpException(
        'Too many failed attempts. Try again in a few minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const verifyPassword = await bcrypt.compare(login.password, admin.password);

    if (!verifyPassword) {
      const failedLogins = admin.failedLogins + 1;
      const lock = failedLogins >= MAX_FAILED_LOGINS;

      await this.database.admin.update({
        where: { id: admin.id },
        data: {
          failedLogins: lock ? 0 : failedLogins,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
        },
      });

      throw this.invalidCredentials();
    }

    if (admin.failedLogins || admin.lockedUntil) {
      await this.database.admin.update({
        where: { id: admin.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }

    const tokens = await this.issueTokens('ADMIN', admin);

    await this.database.adminSession.create({
      data: {
        id: tokens.sessionId,
        adminId: admin.id,
        tokenHash: tokens.tokenHash,
        lastActivityAt: new Date(),
        expiresAt: tokens.expiresAt,
      },
    });

    return {
      message: 'Login successful',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
    };
  }

  // =========================================================
  // ADMIN REFRESH
  // =========================================================

  async refreshAdmin(dto: RefreshDto) {
    const old = await this.database.adminSession.findUnique({
      where: { tokenHash: this.sha256(dto.refreshToken) },
      include: { admin: true },
    });

    if (!old) {
      throw this.invalidSession();
    }

    if (old.revokedAt) {
      if (old.replacedByTokenId) {
        await this.database.adminSession.updateMany({
          where: { adminId: old.adminId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw this.invalidSession();
    }

    if (old.expiresAt <= new Date()) {
      throw this.invalidSession();
    }

    const tokens = await this.issueTokens('ADMIN', old.admin);

    await this.database.$transaction([
      this.database.adminSession.create({
        data: {
          id: tokens.sessionId,
          adminId: old.adminId,
          tokenHash: tokens.tokenHash,
          lastActivityAt: new Date(),
          expiresAt: tokens.expiresAt,
        },
      }),
      this.database.adminSession.update({
        where: { id: old.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: tokens.sessionId,
          lastActivityAt: new Date(),
        },
      }),
    ]);

    return {
      message: 'Token refreshed',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sessionId: tokens.sessionId,
    };
  }

  // =========================================================
  // ADMIN LOGOUT
  // =========================================================

  async adminLogout(logoutDto: LogoutDto) {
    const session = await this.database.adminSession.findUnique({
      where: {
        id: logoutDto.sessionId,
      },
    });

    if (!session) {
      throw new NotFoundException('Admin session not found');
    }

    if (session.revokedAt) {
      return {
        message: 'Already logged out',
      };
    }

    await this.database.adminSession.update({
      where: {
        id: logoutDto.sessionId,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return {
      message: 'Logged out successfully',
    };
  }

  // =========================================================
  // DELETE ADMIN
  // =========================================================

  async deleteAdmin(id: string) {
    const findAdmin = await this.database.admin.findUnique({
      where: { id },
    });

    if (!findAdmin) {
      throw new NotFoundException('Admin not found');
    }

    await this.database.admin.delete({
      where: { id },
    });

    return {
      message: 'Admin deleted successfully',
    };
  }
}