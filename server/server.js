import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from './config.js';
import { initAuth } from './auth.js';
import apiRoutes from './routes/api.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true
});

// Inicialização de segurança e banco de credenciais
await initAuth();

// Rate limiting contra brute-force
await fastify.register(fastifyRateLimit, {
  max: 100,
  timeWindow: '1 minute'
});

// Cookies & Session HttpOnly
await fastify.register(fastifyCookie);
await fastify.register(fastifySession, {
  secret: CONFIG.SESSION_SECRET,
  cookie: {
    secure: false, // O Caddy gerencia SSL na frente, tráfego interno é HTTP
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias
  }
});

// Suporte para upload de imagens (Ctrl+V)
await fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB max por imagem
  }
});

// Servir arquivos estáticos do frontend
await fastify.register(fastifyStatic, {
  root: path.resolve(__dirname, '../public'),
  prefix: '/'
});

// Registrar rotas da API (anexos são servidos por rotas autenticadas)
await fastify.register(apiRoutes);

// Iniciar servidor
try {
  await fastify.listen({ port: CONFIG.PORT, host: CONFIG.HOST });
  console.log(`\n✨ Kanban rodando em http://${CONFIG.HOST}:${CONFIG.PORT}\n`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

