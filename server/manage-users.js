import argon2 from 'argon2';
import fs from 'fs';
import { CONFIG } from './config.js';

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.log('\n❌ Uso: node server/manage-users.js <usuario> <senha>\nExemplo: node server/manage-users.js joao MinhaSenhaForte123\n');
  process.exit(1);
}

async function run() {
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3
  });

  let usersData = { users: [] };
  if (fs.existsSync(CONFIG.USERS_FILE)) {
    try {
      usersData = JSON.parse(fs.readFileSync(CONFIG.USERS_FILE, 'utf-8'));
      if (!Array.isArray(usersData.users)) {
        usersData.users = [];
      }
    } catch {
      usersData = { users: [] };
    }
  }

  const existingIndex = usersData.users.findIndex(
    u => u.username.toLowerCase() === username.toLowerCase()
  );

  if (existingIndex >= 0) {
    usersData.users[existingIndex].passwordHash = hash;
    usersData.users[existingIndex].updatedAt = new Date().toISOString();
    console.log(`\n✅ Usuário '${username}' já existia e teve sua senha atualizada com sucesso!\n`);
  } else {
    usersData.users.push({
      username: username.trim(),
      passwordHash: hash,
      createdAt: new Date().toISOString()
    });
    console.log(`\n✅ Novo usuário '${username}' criado com sucesso!\n`);
  }

  fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(usersData, null, 2), 'utf-8');
}

run();

