import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login?: string;
}

export function initUsersTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    )
  `);
  // 不再自动创建任何默认用户，密码永远不会被覆盖
  const count = db.prepare("SELECT count(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
  if (count.c === 0) {
    console.log('[auth] WARNING: No admin user found. Please create one manually.');
  } else {
    console.log(`[auth] ${count.c} admin user(s) found, ready.`);
  }
}

export function authenticateUser(username: string, password: string): User | null {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
  if (!user) return null;
  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return null;
  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  return user;
}

export function getUserById(id: string): User | null {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | null;
}

export function getUserByUsername(username: string): User | null {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | null;
}

export function createUser(username: string, password: string, role: 'admin' | 'user' = 'user'): User {
  const db = getDb();
  const id = 'user_' + Date.now();
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (id, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(id, username, passwordHash, role);
  return getUserById(id)!;
}

export function changePassword(userId: string, newPassword: string): void {
  const db = getDb();
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function listUsers(): Omit<User, 'password_hash'>[] {
  const db = getDb();
  return db.prepare('SELECT id, username, role, created_at, last_login FROM users').all() as Omit<User, 'password_hash'>[];
}

export function deleteUser(userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}
