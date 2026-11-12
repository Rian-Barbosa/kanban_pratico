import fs from 'fs';
import argon2 from 'argon2';
import { CONFIG } from './config.js';

export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3
  });
}

export function promptHiddenInput(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);

    if (!process.stdin.isTTY) {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', chunk => {
        data += chunk;
      });
      process.stdin.on('end', () => {
        resolve(data.split(/\r?\n/)[0] || '');
      });
      return;
    }

    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(input);
          return;
        } else if (ch === '\u0003') {
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(130);
        } else if (ch === '\u007f' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          input += ch;
          process.stdout.write('*');
        }
      }
    };

    stdin.on('data', onData);
  });
}

export async function initAuth() {
  if (!fs.existsSync(CONFIG.USERS_FILE)) {
    const hash = await hashPassword('admin');

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

export function listUsernames() {
  if (!fs.existsSync(CONFIG.USERS_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
    if (!Array.isArray(data.users)) return [];
    return data.users
      .map(u => ({ username: u.username }))
      .filter(u => typeof u.username === 'string' && u.username.trim().length > 0);
  } catch {
    return [];
  }
}

export function authMiddleware(req, reply, done) {
  if (req.session && req.session.user) {
    return done();
  }
  return reply.code(401).send({ error: 'Não autorizado. Faça login primeiro.' });
}

