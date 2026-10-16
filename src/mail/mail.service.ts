import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  async sendOtp(email: string, otp: string) {
    await this.transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your verification code',
      html: `
        <h2>Email Verification</h2>

        <p>Your verification code is:</p>

        <h1>${otp}</h1>

        <p>This code expires in 10 minutes.</p>
      `,
    });
  }

  async sendWelcome(email: string, name: string, tempPassword: string) {
    await this.transporter.sendMail({
      from: `"My App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your account is ready',
      html: `
        <h2>Welcome, ${escapeHtml(name)}</h2>

        <p>Your account has been created. Sign in with:</p>

        <p>Email: <strong>${escapeHtml(email)}</strong></p>
        <p>Temporary password: <strong>${escapeHtml(tempPassword)}</strong></p>

        <p>You will be asked to change this password the first time you sign in.</p>

        ${
          process.env.APP_URL
            ? `<p><a href="${escapeHtml(process.env.APP_URL)}">Open the platform</a></p>`
            : ''
        }
      `,
    });
  }
}