import argon2 from 'argon2';
import fs from 'fs';
import { CONFIG } from './config.js';

const newPassword = process.argv[2];

if (!newPassword) {
  console.log('\n❌ Uso: node server/change-password.js <nova_senha>\nExemplo: node server/change-password.js MinhaSenhaForte123\n');
  process.exit(1);
}

async function run() {
  const hash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3
  });

  const usersData = {
    users: [
      {
        username: 'admin',
        passwordHash: hash,
        updatedAt: new Date().toISOString()
      }
    ]
  };

  fs.writeFileSync(CONFIG.USERS_FILE, JSON.stringify(usersData, null, 2), 'utf-8');
  console.log(`\n✅ Senha do usuário 'admin' atualizada com sucesso!\n`);
}

run();

