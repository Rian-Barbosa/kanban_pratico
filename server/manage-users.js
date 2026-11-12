import fs from 'fs';
import { CONFIG } from './config.js';
import { hashPassword, promptHiddenInput } from './auth.js';

const username = process.argv[2];
let password = process.argv[3];

if (!username) {
  console.log('\n❌ Uso: node server/manage-users.js <usuario>\nExemplo: node server/manage-users.js joao\n(A senha será solicitada de forma oculta para não ficar no histórico do terminal)\n');
  process.exit(1);
}

async function run() {
  if (!password) {
    password = await promptHiddenInput(`Digite a senha para '${username}': `);
    if (!password) {
      console.log('\n❌ A senha não pode ser vazia.\n');
      process.exit(1);
    }
  }

  const hash = await hashPassword(password);

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
