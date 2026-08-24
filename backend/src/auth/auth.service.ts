import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserRepository, type UserRow } from '../db/repositories/user.repository';
import { AppError } from '../api/middleware/error.middleware';

const BCRYPT_ROUNDS = 12;

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
}

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, name: row.name };
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return secret;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): { sub: string } {
  return jwt.verify(token, getJwtSecret()) as { sub: string };
}

// ALLOWED_EMAIL_DOMAINS gates self-registration to a comma-separated allowlist
// (e.g. "datadoghq.com") — unset means open registration (today's default,
// kept for local dev/testing), so this is opt-in hardening an operator turns
// on for a real deployment rather than a breaking change.
function assertAllowedEmailDomain(email: string): void {
  const allowlist = process.env.ALLOWED_EMAIL_DOMAINS;
  if (!allowlist) return;

  const domains = allowlist.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length === 0) return;

  const emailDomain = email.split('@')[1]?.toLowerCase();
  if (!emailDomain || !domains.includes(emailDomain)) {
    throw new AppError('Registration is restricted to specific email domains', 403);
  }
}

export async function register(email: string, password: string, name?: string): Promise<{ token: string; user: PublicUser }> {
  assertAllowedEmailDomain(email);

  const existing = await UserRepository.findByEmail(email);
  if (existing) {
    throw new AppError('An account with this email already exists', 409);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await UserRepository.create({ id: uuidv4(), email, passwordHash, name });

  return { token: signToken(user.id), user: toPublicUser(user) };
}

export async function login(email: string, password: string): Promise<{ token: string; user: PublicUser }> {
  const user = await UserRepository.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password', 401);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('Invalid email or password', 401);
  }

  return { token: signToken(user.id), user: toPublicUser(user) };
}

export async function getUserById(id: string): Promise<PublicUser | null> {
  const user = await UserRepository.findById(id);
  return user ? toPublicUser(user) : null;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const user = await UserRepository.findById(userId);
  if (!user) {
    throw new AppError('User not found', 404);
  }

  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 401);
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await UserRepository.updatePasswordHash(userId, passwordHash);
}
