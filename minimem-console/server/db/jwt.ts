import jwt from 'jsonwebtoken';
import { getUserById } from './users.js';

const JWT_SECRET = process.env.CONSOLE_JWT_SECRET || 'minimem-console-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
}

export function generateToken(userId: string, username: string, role: string): string {
  return jwt.sign({ userId, username, role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

export function authMiddleware(token: string): { userId: string; username: string; role: string } | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  
  // 验证用户是否仍然存在
  const user = getUserById(payload.userId);
  if (!user) return null;
  
  return payload;
}
