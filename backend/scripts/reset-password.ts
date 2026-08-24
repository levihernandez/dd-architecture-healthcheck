import 'dotenv/config';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getDatabase, closeDatabase } from '../src/db/database';

const BCRYPT_ROUNDS = 12;

function parseArgs(): { email: string; password?: string } {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const email = get('--email');
  const password = get('--password');
  if (!email) {
    console.error('Usage: npm run reset-password -- --email user@example.com [--password newPassword]');
    console.error('  Omit --password to generate a random one-time password (printed once, not stored anywhere).');
    process.exit(1);
  }
  return { email, password };
}

function generatePassword(): string {
  // 16 random bytes, base64url — well above the 8-char minimum, no ambiguous
  // characters to transcribe since it's meant to be copy-pasted, not typed.
  return crypto.randomBytes(16).toString('base64url');
}

async function main() {
  const { email, password } = parseArgs();

  if (password && password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const db = getDatabase();
  const user = await db('users').where({ email }).first();
  if (!user) {
    console.error(`No account found for ${email}`);
    process.exit(1);
  }

  const newPassword = password ?? generatePassword();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db('users').where({ id: user.id }).update({
    password_hash: passwordHash,
    updated_at: new Date().toISOString(),
  });

  console.log(`Password reset for ${email}.`);
  if (!password) {
    console.log(`Temporary password: ${newPassword}`);
    console.log('Share this with the user out-of-band; it is not stored or logged anywhere else.');
  }
}

main()
  .catch((err) => { console.error('FAILED:', err); process.exitCode = 1; })
  .finally(() => closeDatabase());
