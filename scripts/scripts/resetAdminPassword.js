import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const [,, emailArg, passwordArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error('Usage: node scripts/resetAdminPassword.js <email> <newPassword>');
  process.exit(1);
}

async function main() {
  const hash = await bcrypt.hash(passwordArg, 12);

  const user = await prisma.users.upsert({
    where: { email: emailArg },
    update: {
      password: hash,
      isActive: true,
      role: 'ADMIN',
      name: 'Admin User'
    },
    create: {
      email: emailArg,
      password: hash,
      isActive: true,
      role: 'ADMIN',
      name: 'Admin User'
    }
  });

  console.log('OK', { id: user.id, email: user.email, role: user.role, isActive: user.isActive });
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
