import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type AdminSeed = { name: string; email: string; password: string };

// =========================================================
// ADD YOUR ADMINS HERE (one object per admin)
// =========================================================
const ADMINS: AdminSeed[] = [
//   { name: 'Basil', email: 'admin@example.com', password: 'change-this-password' },
  // { name: 'Ada', email: 'ada@example.com', password: 'another-password' },
];

function validateAdmins(list: AdminSeed[]): AdminSeed[] {
  if (list.length === 0) {
    throw new Error('Add at least one admin to the ADMINS list in prisma/seed.ts');
  }

  const seen = new Set<string>();

  return list.map((entry, index) => {
    const email = entry.email?.toLowerCase().trim();
    const password = entry.password;
    const label = `Admin #${index + 1}`;

    if (!email || !password) {
      throw new Error(`${label}: email and password are required`);
    }
    if (password.length < 8) {
      throw new Error(`${label} (${email}): password must be at least 8 characters`);
    }
    if (seen.has(email)) {
      throw new Error(`${label}: ${email} is listed twice`);
    }
    seen.add(email);

    return { name: entry.name?.trim() || 'admin', email, password };
  });
}

async function main() {
  // validate every entry first so a typo never leaves a half-seeded list
  const admins = validateAdmins(ADMINS);

  for (const admin of admins) {
    const hash = await bcrypt.hash(admin.password, 12);

    // update is empty on purpose: re-running the seed never resets an existing admin's password
    const result = await prisma.admin.upsert({
      where: { email: admin.email },
      update: {},
      create: { name: admin.name, email: admin.email, password: hash },
    });

    console.log(`Admin ready: ${result.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });