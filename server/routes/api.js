import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import { listProjects, loadProject, saveProject, sanitizeFilename, listCollaborators, saveCollaborator, deleteCollaborator, deleteProject, renameProject, getSettings, updateSettings } from '../storage.js';
import { verifyUser } from '../auth.js';

export default async function apiRoutes(fastify, options) {
  // --- Autenticação ---
  fastify.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return reply.code(400).send({ error: 'Usuário e senha são obrigatórios.' });
    }

    const user = await verifyUser(username, password);
    if (!user) {
      return reply.code(401).send({ error: 'Usuário ou senha incorretos.' });
    }

    req.session.user = { username: user.username };
    return { ok: true, user: { username: user.username } };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    req.session.destroy();
    return { ok: true };
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    if (req.session && req.session.user) {
      return { authenticated: true, user: req.session.user };
    }
    return { authenticated: false };
  });

  // --- Rotas Protegidas de Projetos ---
  fastify.register(async function (protectedRoutes) {
    protectedRoutes.addHook('preHandler', async (req, reply) => {
      if (!req.session || !req.session.user) {
        return reply.code(401).send({ error: 'Sessão expirada ou não autenticada.' });
      }
    });

    // Listar todos os projetos
    protectedRoutes.get('/api/projects', async () => {
      return listProjects();
    });

    // Criar novo projeto
    protectedRoutes.post('/api/projects', async (req, reply) => {
      const { title } = req.body || {};
      if (!title) {
        return reply.code(400).send({ error: 'Título é obrigatório.' });
      }

      const id = title.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'projeto';
      const initialData = {
        title,
        columns: [
          { id: 'col_todo', title: 'A Fazer', cards: [] },
          { id: 'col_prog', title: 'Em Andamento', cards: [] },
          { id: 'col_done', title: 'Concluído', cards: [] }
        ]
      };

      saveProject(id, initialData);
      return { id, ...initialData };
    });

    // Obter dados de um projeto específico
    protectedRoutes.get('/api/projects/:id', async (req, reply) => {
      const { id } = req.params;
      const project = loadProject(id);
      if (!project) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }
      return project;
    });

    // Salvar/atualizar um projeto específico
    protectedRoutes.put('/api/projects/:id', async (req, reply) => {
      const { id } = req.params;
      const projectData = req.body;

      if (!projectData || !Array.isArray(projectData.columns)) {
        return reply.code(400).send({ error: 'Formato de projeto inválido.' });
      }

      saveProject(id, projectData);
      return { ok: true };
    });

    // Renomear projeto
    protectedRoutes.patch('/api/projects/:id', async (req, reply) => {
      const { id } = req.params;
      const { title } = req.body || {};
      if (!title) {
        return reply.code(400).send({ error: 'Título é obrigatório.' });
      }

      const updated = renameProject(id, title);
      if (!updated) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }
      return updated;
    });

    // Excluir projeto
    protectedRoutes.delete('/api/projects/:id', async (req, reply) => {
      const { id } = req.params;
      const deleted = deleteProject(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }
      return { ok: true };
    });

    // Upload de Imagens (Ctrl+V ou Arquivo)
    protectedRoutes.post('/api/attachments', async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
      }

      if (!fs.existsSync(CONFIG.ATTACHMENTS_DIR)) {
        fs.mkdirSync(CONFIG.ATTACHMENTS_DIR, { recursive: true });
      }

      const ext = path.extname(data.filename) || '.png';
      const fileHash = crypto.randomBytes(8).toString('hex');
      const savedFilename = `img_${Date.now()}_${fileHash}${ext}`;
      const savePath = path.join(CONFIG.ATTACHMENTS_DIR, savedFilename);

      await pipeline(data.file, fs.createWriteStream(savePath));

      return {
        filename: savedFilename,
        url: `/attachments/${savedFilename}`,
        markdown: `![[${savedFilename}]]`
      };
    });

    // --- Rotas de Configurações Gerais (Nome do App, etc) ---
    protectedRoutes.get('/api/settings', async () => {
      return getSettings();
    });

    protectedRoutes.put('/api/settings', async (req, reply) => {
      const { appName } = req.body || {};
      if (typeof appName !== 'string') {
        return reply.code(400).send({ error: 'Configuração inválida.' });
      }
      return updateSettings({ appName });
    });

    // --- Rotas de Colaboradores ---
    protectedRoutes.get('/api/collaborators', async () => {
      return listCollaborators();
    });

    protectedRoutes.post('/api/collaborators', async (req, reply) => {
      const { name, role, color } = req.body || {};
      if (!name) {
        return reply.code(400).send({ error: 'Nome do colaborador é obrigatório.' });
      }
      const created = saveCollaborator({ name, role: role || 'Membro', color: color || '#e0f2fe' });
      return created;
    });

    protectedRoutes.delete('/api/collaborators/:id', async (req, reply) => {
      const { id } = req.params;
      deleteCollaborator(id);
      return { ok: true };
    });
  });
}

