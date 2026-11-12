import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
const SECRET_FILE = path.join(DATA_DIR, 'session.key');

/**
 * Obtém ou gera uma chave de sessão criptográfica segura de 64 caracteres.
 * Se SESSION_SECRET for fornecido via ambiente e for forte (>= 32 chars), usa-o.
 * Caso contrário, gera uma chave aleatória e salva no disco local em data/session.key.
 * Nunca usa strings padrão expostas no código.
 */
function getOrGenerateSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 32) {
    return process.env.SESSION_SECRET.trim();
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(SECRET_FILE)) {
    const existing = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (existing.length >= 32) {
      return existing;
    }
  }

  // Gera uma chave aleatória criptograficamente segura de 256 bits (64 hex chars)
  const newSecret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, newSecret, { mode: 0o600, encoding: 'utf-8' });
  return newSecret;
}

export const CONFIG = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  SESSION_SECRET: getOrGenerateSessionSecret(),
  VAULTS_DIR: path.join(DATA_DIR, 'vaults'),
  ATTACHMENTS_DIR: path.join(DATA_DIR, 'attachments'),
  COMMENTS_DIR: path.join(DATA_DIR, 'comments'),
  USERS_FILE: path.join(DATA_DIR, 'users.json'),
  WORKSPACES_FILE: path.join(DATA_DIR, 'workspaces.json'),
  COLLABORATORS_FILE: path.join(DATA_DIR, 'collaborators.json'),
  SETTINGS_FILE: path.join(DATA_DIR, 'settings.json')
};

