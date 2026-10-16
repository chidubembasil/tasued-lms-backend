import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { SignUpDto } from './dto/signup_dto.js';
import { SignInDto } from './dto/signIn_dto.js';
import { LogoutDto } from './dto/logout_dto.js';
import { ChangePasswordDto } from './dto/changePassword_dto.js';
import { ForgotPasswordDto } from './dto/forgotPassword_dto.js';
import { ResetPasswordDto } from './dto/resetPassword_dto.js';
import { AuthGuard } from './guards/auth/auth.guard.js';
import { RolesGuard } from './guards/role/role.guard.js';
import { Roles } from './decorators/role/role.decorator.js';
import { CurrentUser } from './decorators/current-user/current-user.decorator.js';
import type { AuthUser } from '../types/auth-user.js';

const USER_REFRESH_COOKIE = 'refresh_token';
const ADMIN_REFRESH_COOKIE = 'admin_refresh_token';
const COOKIE_PATH = '/auth'; // the browser only sends the refresh cookie to /auth/*
const REFRESH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // =========================================================
  // COOKIE HELPERS
  // =========================================================

  private cookieOptions() {
    const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax') as
      | 'lax'
      | 'strict'
      | 'none';

    return {
      httpOnly: true,
      secure: sameSite === 'none' || process.env.NODE_ENV === 'production',
      sameSite,
      path: COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, name: string, token: string) {
    res.cookie(name, token, {
      ...this.cookieOptions(),
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }

  private clearRefreshCookie(res: Response, name: string) {
    res.clearCookie(name, this.cookieOptions());
  }

  private readCookie(req: Request, name: string): string | undefined {
    const raw = req.headers.cookie;
    if (!raw) return undefined;

    for (const part of raw.split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === name) {
        return decodeURIComponent(value.join('='));
      }
    }
    return undefined;
  }

  // =========================================================
  // USERS (students, lecturers, HODs, deans)
  // =========================================================

  // users normally arrive through the CSV import, so manual signup is admin only
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a user manually (admin only)' })
  @Post('signup')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  signupUser(@Body() dto: SignUpDto) {
    return this.auth.signupUser(dto);
  }

  @ApiOperation({
    summary: 'User sign in',
    description:
      'Returns an access token in the body and sets the refresh token as an httpOnly cookie.',
  })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.auth.loginUser(dto);
    this.setRefreshCookie(res, USER_REFRESH_COOKIE, refreshToken);
    return result;
  }

  @ApiOperation({
    summary: 'Get a new access token',
    description: 'Reads the refresh token from the httpOnly cookie and rotates it.',
  })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readCookie(req, USER_REFRESH_COOKIE);

    if (!token) {
      throw new UnauthorizedException('No refresh token');
    }

    try {
      const { refreshToken, ...result } = await this.auth.refreshUser({
        refreshToken: token,
      });
      this.setRefreshCookie(res, USER_REFRESH_COOKIE, refreshToken);
      return result;
    } catch (error) {
      this.clearRefreshCookie(res, USER_REFRESH_COOKIE);
      throw error;
    }
  }

  @ApiOperation({ summary: 'Sign out one session' })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.clearRefreshCookie(res, USER_REFRESH_COOKIE);
    return this.auth.logout(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign out of all devices' })
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (user.kind !== 'USER') {
      throw new ForbiddenException('Not available for admin accounts');
    }
    this.clearRefreshCookie(res, USER_REFRESH_COOKIE);
    return this.auth.logoutAll(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current signed-in user or admin' })
  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    if (user.kind === 'ADMIN') {
      return { id: user.id, email: user.email, role: 'ADMIN' };
    }
    return this.auth.getMe(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change your password (signs out other devices)' })
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ) {
    if (user.kind !== 'USER') {
      throw new ForbiddenException('Not available for admin accounts');
    }
    return this.auth.changePassword(user.id, dto, user.sessionId);
  }

  @ApiOperation({ summary: 'Email a 6-digit password reset code' })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @ApiOperation({ summary: 'Reset password using the emailed code' })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users (admin only)' })
  @Get('users')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAllUsers() {
    return this.auth.getAllUsers();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get one user (admin only)' })
  @Get('users/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  getOneUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.auth.getOneUser(id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  @Delete('users/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.auth.deleteUser(id);
  }

  // =========================================================
  // ADMINS
  // =========================================================

  @ApiOperation({
    summary: 'Admin sign in',
    description:
      'Returns an access token in the body and sets the admin refresh token as an httpOnly cookie.',
  })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  async loginAdmin(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...result } = await this.auth.loginAdmin(dto);
    this.setRefreshCookie(res, ADMIN_REFRESH_COOKIE, refreshToken);
    return result;
  }

  @ApiOperation({
    summary: 'Get a new admin access token',
    description: 'Reads the admin refresh token from the httpOnly cookie and rotates it.',
  })
  @Post('admin/refresh')
  @HttpCode(HttpStatus.OK)
  async refreshAdmin(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readCookie(req, ADMIN_REFRESH_COOKIE);

    if (!token) {
      throw new UnauthorizedException('No refresh token');
    }

    try {
      const { refreshToken, ...result } = await this.auth.refreshAdmin({
        refreshToken: token,
      });
      this.setRefreshCookie(res, ADMIN_REFRESH_COOKIE, refreshToken);
      return result;
    } catch (error) {
      this.clearRefreshCookie(res, ADMIN_REFRESH_COOKIE);
      throw error;
    }
  }

  @ApiOperation({ summary: 'Admin sign out' })
  @Post('admin/logout')
  @HttpCode(HttpStatus.OK)
  async adminLogout(
    @Body() dto: LogoutDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.clearRefreshCookie(res, ADMIN_REFRESH_COOKIE);
    return this.auth.adminLogout(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all admins (admin only)' })
  @Get('admins')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  getAllAdmin() {
    return this.auth.getAllAdmin();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an admin (admin only, not yourself)' })
  @Delete('admins/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('ADMIN')
  deleteAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (id === user.id) {
      throw new ForbiddenException('You cannot delete your own admin account');
    }
    return this.auth.deleteAdmin(id);
  }
}