import fs from 'fs';
import { CONFIG } from './config.js';
import { hashPassword, promptHiddenInput } from './auth.js';

let newPassword = process.argv[2];

async function run() {
  if (!newPassword) {
    newPassword = await promptHiddenInput("Digite a nova senha para 'admin': ");
    if (!newPassword) {
      console.log('\n❌ A senha não pode ser vazia.\n');
      process.exit(1);
    }
  }

  const hash = await hashPassword(newPassword);

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
