import { Hono } from 'hono';
import { initUsersTable, authenticateUser, getUserById, listUsers, createUser, changePassword, deleteUser } from '../db/users.js';
import { generateToken, authMiddleware } from '../db/jwt.js';

export const authRoutes = new Hono();

// 初始化用户表
initUsersTable();

// 登录
authRoutes.post('/login', async (c) => {
  const body = await c.req.json();
  const { username, password } = body;
  
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  
  const user = authenticateUser(username, password);
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  
  const token = generateToken(user.id, user.username, user.role);
  
  return c.json({
    success: true,
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
});

// 获取当前用户信息
authRoutes.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = authMiddleware(token);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  const user = getUserById(payload.userId);
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  
  return c.json({
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at,
    last_login: user.last_login,
  });
});

// 修改密码
authRoutes.post('/change-password', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = authMiddleware(token);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  
  const body = await c.req.json();
  const { newPassword } = body;
  
  if (!newPassword || newPassword.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }
  
  changePassword(payload.userId, newPassword);
  return c.json({ success: true });
});

// 用户管理（仅管理员）
authRoutes.get('/users', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = authMiddleware(token);
  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Admin required' }, 403);
  }
  
  return c.json(listUsers());
});

// 创建用户（仅管理员）
authRoutes.post('/users', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = authMiddleware(token);
  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Admin required' }, 403);
  }
  
  const body = await c.req.json();
  const { username, password, role } = body;
  
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  
  const user = createUser(username, password, role || 'user');
  return c.json({ success: true, user });
});

// 删除用户（仅管理员）
authRoutes.delete('/users/:id', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const token = authHeader.slice(7);
  const payload = authMiddleware(token);
  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Admin required' }, 403);
  }
  
  deleteUser(c.req.param('id'));
  return c.json({ success: true });
});
