import fs from 'fs';
import argon2 from 'argon2';
import { CONFIG } from './config.js';

export async function initAuth() {
  if (!fs.existsSync(CONFIG.USERS_FILE)) {
    const defaultPassword = 'admin';
    const hash = await argon2.hash(defaultPassword, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3
    });

    const initialUsers = {
      users: [
        {
          username: 'admin',
          passwordHash: hash,
          createdAt: new Date().toISOString()
        }
      ]
    };

    fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(initialUsers, null, 2), 'utf-8');
    console.log('[Auth] Usuário inicial criado: admin / admin (Recomenda-se trocar a senha)');
  }
}

export async function verifyUser(username, password) {
  if (!fs.existsSync(CONFIG.USERS_FILE)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
    const user = data.users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (!user) return null;

    const valid = await argon2.verify(user.passwordHash, password);
    if (valid) {
      return { username: user.username };
    }
    return null;
  } catch (err) {
    console.error('[Auth Error]', err);
    return null;
  }
}

export function authMiddleware(req, reply, done) {
  if (req.session && req.session.user) {
    return done();
  }
  return reply.code(401).send({ error: 'Não autorizado. Faça login primeiro.' });
}

