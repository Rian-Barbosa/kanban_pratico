import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { CONFIG } from '../config.js';
import {
  listProjects,
  loadProject,
  saveProject,
  listCollaborators,
  saveCollaborator,
  deleteCollaborator,
  deleteProject,
  renameProject,
  getSettings,
  updateSettings,
  ensureDefaultWorkspace,
  listWorkspaces,
  getWorkspace,
  saveWorkspace,
  deleteWorkspace,
  isGlobalAdmin,
  sanitizeIdToken,
  getUserWorkspaceRole,
  canManageWorkspace,
  canAccessProject,
  canManageProject
} from '../storage.js';
import { verifyUser, listUsernames } from '../auth.js';

const ALLOWED_IMAGE_MIMES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};
const ALLOWED_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

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

  // Configurações públicas de branding (necessário antes do login para exibir o nome do app)
  fastify.get('/api/settings', async () => {
    const settings = getSettings();
    return { appName: settings.appName || '📋 Kanban' };
  });

  // --- Rotas Protegidas de Projetos ---
  fastify.register(async function (protectedRoutes) {
    protectedRoutes.addHook('preHandler', async (req, reply) => {
      if (!req.session || !req.session.user) {
        return reply.code(401).send({ error: 'Sessão expirada ou não autenticada.' });
      }
    });

    // --- Rotas de Workspaces ---
    protectedRoutes.get('/api/workspaces', async (req) => {
      const username = req.session.user.username;
      const all = listWorkspaces();
      return all
        .map(ws => {
          const role = getUserWorkspaceRole(ws, username);
          if (!role) return null;
          return {
            ...ws,
            myRole: role,
            isGlobalAdmin: isGlobalAdmin(username)
          };
        })
        .filter(Boolean);
    });

    protectedRoutes.post('/api/workspaces', async (req, reply) => {
      const username = req.session.user.username;
      if (!isGlobalAdmin(username)) {
        return reply.code(403).send({ error: 'Apenas o administrador global pode criar workspaces.' });
      }
      const { name } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return reply.code(400).send({ error: 'Nome do workspace é obrigatório.' });
      }
      const cleanName = name.trim();
      const baseSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'ws';
      const id = `ws_${baseSlug.slice(0, 24)}_${crypto.randomBytes(2).toString('hex')}`;
      const ws = {
        id,
        name: cleanName,
        owner: username,
        members: [],
        createdAt: new Date().toISOString()
      };
      saveWorkspace(ws);
      return { ...ws, myRole: 'owner', isGlobalAdmin: true };
    });

    protectedRoutes.patch('/api/workspaces/:id', async (req, reply) => {
      const username = req.session.user.username;
      if (!isGlobalAdmin(username)) {
        return reply.code(403).send({ error: 'Apenas o administrador global pode renomear workspaces.' });
      }
      const ws = getWorkspace(req.params.id);
      if (!ws) {
        return reply.code(404).send({ error: 'Workspace não encontrado.' });
      }
      const { name } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return reply.code(400).send({ error: 'Nome do workspace é obrigatório.' });
      }
      ws.name = name.trim();
      saveWorkspace(ws);
      return { ...ws, myRole: 'owner', isGlobalAdmin: true };
    });

    protectedRoutes.delete('/api/workspaces/:id', async (req, reply) => {
      const username = req.session.user.username;
      if (!isGlobalAdmin(username)) {
        return reply.code(403).send({ error: 'Apenas o administrador global pode excluir workspaces.' });
      }
      const ws = getWorkspace(req.params.id);
      if (!ws) {
        return reply.code(404).send({ error: 'Workspace não encontrado.' });
      }
      const hasProjects = listProjects().some(p => p.workspace === ws.id);
      if (hasProjects) {
        return reply.code(400).send({ error: 'Exclua os projetos deste workspace antes de removê-lo.' });
      }
      deleteWorkspace(ws.id);
      return { ok: true };
    });

    protectedRoutes.put('/api/workspaces/:id/members', async (req, reply) => {
      const username = req.session.user.username;
      const ws = getWorkspace(req.params.id);
      if (!ws) {
        return reply.code(404).send({ error: 'Workspace não encontrado.' });
      }
      if (!canManageWorkspace(ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para gerenciar membros deste workspace.' });
      }

      const { members } = req.body || {};
      if (!Array.isArray(members)) {
        return reply.code(400).send({ error: 'Formato de membros inválido.' });
      }

      const validUsernames = new Set(listUsernames().map(u => u.username.toLowerCase()));
      const callerIsOwnerOrGlobal = isGlobalAdmin(username) || (ws.owner && ws.owner.toLowerCase() === username.toLowerCase());

      // Preserva admins existentes caso um workspace_admin comum tente alterá-los
      const existingAdmins = new Map(
        (ws.members || [])
          .filter(m => m.role === 'admin')
          .map(m => [m.username.toLowerCase(), m])
      );

      const sanitizedMembers = [];
      const seen = new Set();

      for (const item of members) {
        if (!item || typeof item.username !== 'string') continue;
        const cleanUser = sanitizeIdToken(item.username);
        const lower = cleanUser.toLowerCase();
        if (!cleanUser || !validUsernames.has(lower) || lower === 'admin' || (ws.owner && lower === ws.owner.toLowerCase()) || seen.has(lower)) {
          continue;
        }
        seen.add(lower);

        const requestedRole = item.role === 'admin' ? 'admin' : 'member';
        if (!callerIsOwnerOrGlobal) {
          // Admin de workspace não pode promover ninguém a admin nem remover/rebaixar outro admin
          if (requestedRole === 'admin' && !existingAdmins.has(lower)) {
            return reply.code(403).send({ error: 'Apenas o administrador global ou dono pode promover administradores de workspace.' });
          }
          if (existingAdmins.has(lower) && requestedRole !== 'admin') {
            return reply.code(403).send({ error: 'Apenas o administrador global ou dono pode alterar o papel de um administrador de workspace.' });
          }
        }

        sanitizedMembers.push({ username: cleanUser, role: requestedRole });
      }

      if (!callerIsOwnerOrGlobal) {
        for (const [lowerAdmin] of existingAdmins.entries()) {
          if (!seen.has(lowerAdmin)) {
            return reply.code(403).send({ error: 'Apenas o administrador global ou dono pode remover um administrador de workspace.' });
          }
        }
      }

      ws.members = sanitizedMembers;
      saveWorkspace(ws);
      return { ...ws, myRole: getUserWorkspaceRole(ws, username), isGlobalAdmin: isGlobalAdmin(username) };
    });

    // Listar usernames disponíveis para compartilhamento (sem expor hashes)
    protectedRoutes.get('/api/users', async (req, reply) => {
      const username = req.session.user.username;
      const canManageAny = isGlobalAdmin(username) || listWorkspaces().some(ws => canManageWorkspace(ws, username));
      if (!canManageAny) {
        return reply.code(403).send({ error: 'Sem permissão para listar usuários.' });
      }
      return listUsernames();
    });

    // Listar projetos acessíveis pelo usuário (opcionalmente filtrados por workspaceId)
    protectedRoutes.get('/api/projects', async (req) => {
      const username = req.session.user.username;
      const workspaceFilter = req.query?.workspaceId ? sanitizeIdToken(req.query.workspaceId) : null;
      const workspacesMap = new Map(listWorkspaces().map(w => [w.id, w]));

      return listProjects()
        .filter(proj => {
          if (workspaceFilter && proj.workspace !== workspaceFilter) return false;
          const ws = workspacesMap.get(proj.workspace) || getWorkspace('ws_default');
          return canAccessProject(proj, ws, username);
        })
        .map(proj => {
          const ws = workspacesMap.get(proj.workspace) || getWorkspace('ws_default');
          return {
            ...proj,
            canManage: canManageProject(proj, ws, username)
          };
        });
    });

    // Criar novo projeto
    protectedRoutes.post('/api/projects', async (req, reply) => {
      const username = req.session.user.username;
      const { title, workspaceId } = req.body || {};
      if (typeof title !== 'string' || !title.trim()) {
        return reply.code(400).send({ error: 'Título é obrigatório.' });
      }

      const ws = getWorkspace(workspaceId);
      if (!ws) {
        return reply.code(400).send({ error: 'Selecione ou crie um workspace válido primeiro.' });
      }

      if (!canManageWorkspace(ws, username)) {
        return reply.code(403).send({ error: 'Apenas o administrador ou dono do workspace pode criar projetos.' });
      }

      const cleanTitle = title.trim();
      const baseId = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'projeto';
      const id = loadProject(baseId) ? `${baseId}-${crypto.randomBytes(2).toString('hex')}` : baseId;

      const initialData = {
        title: cleanTitle,
        workspace: ws.id,
        owner: username,
        allowed_users: [],
        columns: [
          { id: 'col_backlog', title: 'Backlog', color: 'col-gray', cards: [] },
          { id: 'col_todo', title: 'To do', color: 'col-blue', cards: [] },
          { id: 'col_prog', title: 'In progress', color: 'col-amber', cards: [] },
          { id: 'col_done', title: 'Done', color: 'col-green', cards: [] }
        ]
      };

      saveProject(id, initialData);
      return { id, ...initialData, canManage: true };
    });

    // Obter dados de um projeto específico
    protectedRoutes.get('/api/projects/:id', async (req, reply) => {
      const username = req.session.user.username;
      const { id } = req.params;
      const project = loadProject(id);
      if (!project) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }

      const ws = getWorkspace(project.workspace) || getWorkspace('ws_default');
      if (!canAccessProject(project, ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para acessar este projeto.' });
      }

      const projectMembersSet = new Map();
      const addProjectMember = (name) => {
        if (!name || typeof name !== 'string') return;
        const clean = name.trim();
        if (clean && !projectMembersSet.has(clean.toLowerCase())) {
          projectMembersSet.set(clean.toLowerCase(), clean);
        }
      };
      addProjectMember(project.owner);
      addProjectMember(ws?.owner);
      (ws?.members || []).forEach(m => {
        if (m.role === 'admin') addProjectMember(m.username);
      });
      (project.allowed_users || []).forEach(u => addProjectMember(u));

      return {
        ...project,
        projectMembers: Array.from(projectMembersSet.values()),
        canManage: canManageProject(project, ws, username)
      };
    });

    // Salvar/atualizar um projeto específico (preserva metadados de permissão contra adulteração)
    protectedRoutes.put('/api/projects/:id', async (req, reply) => {
      const username = req.session.user.username;
      const { id } = req.params;
      const existing = loadProject(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }

      const ws = getWorkspace(existing.workspace) || getWorkspace('ws_default');
      if (!canAccessProject(existing, ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para editar este projeto.' });
      }

      const projectData = req.body;
      if (!projectData || !Array.isArray(projectData.columns)) {
        return reply.code(400).send({ error: 'Formato de projeto inválido.' });
      }

      const canManage = canManageProject(existing, ws, username);
      if (!canManage) {
        // Colaborador comum: pode APENAS movimentar cards existentes entre as mesmas colunas
        const incomingCols = projectData.columns;
        if (incomingCols.length !== existing.columns.length) {
          return reply.code(403).send({ error: 'Colaboradores comuns podem apenas movimentar cards entre listas.' });
        }

        for (let i = 0; i < existing.columns.length; i++) {
          const exCol = existing.columns[i];
          const inCol = incomingCols[i];
          if (!inCol || !Array.isArray(inCol.cards) || inCol.title !== exCol.title || (inCol.color || '') !== (exCol.color || '')) {
            return reply.code(403).send({ error: 'Colaboradores comuns não podem criar, editar, excluir ou reordenar listas.' });
          }
        }

        const cardFingerprint = (c) => JSON.stringify({
          content: c?.content || '',
          urgency: c?.urgency || null,
          dueDate: c?.dueDate || null,
          assignees: Array.isArray(c?.assignees) ? c.assignees : (c?.assignee ? [c.assignee] : []),
          completed: Boolean(c?.completed)
        });

        const exCards = existing.columns.flatMap(col => col.cards.map(cardFingerprint)).sort();
        const inCards = incomingCols.flatMap(col => col.cards.map(cardFingerprint)).sort();

        if (exCards.length !== inCards.length || exCards.some((fp, idx) => fp !== inCards[idx])) {
          return reply.code(403).send({ error: 'Colaboradores comuns podem apenas movimentar cards entre listas, sem criar, editar ou excluir cards.' });
        }
      }

      // Hardening: nunca aceita alteração de owner/workspace/allowed_users via PUT do quadro
      const safeProjectData = {
        ...projectData,
        title: canManage && typeof projectData.title === 'string' && projectData.title.trim()
          ? projectData.title.trim()
          : existing.title,
        workspace: existing.workspace,
        owner: existing.owner,
        allowed_users: existing.allowed_users
      };

      saveProject(id, safeProjectData);
      return { ok: true };
    });

    // Gerenciar acessos de membros ao projeto
    protectedRoutes.put('/api/projects/:id/access', async (req, reply) => {
      const username = req.session.user.username;
      const { id } = req.params;
      const project = loadProject(id);
      if (!project) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }

      const ws = getWorkspace(project.workspace) || getWorkspace('ws_default');
      if (!canManageProject(project, ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para gerenciar acessos deste projeto.' });
      }

      const { allowed_users } = req.body || {};
      if (!Array.isArray(allowed_users)) {
        return reply.code(400).send({ error: 'Lista de usuários inválida.' });
      }

      const validUsers = new Set(listUsernames().map(u => u.username.toLowerCase()));
      const wsMembers = new Set((ws?.members || []).map(m => m.username.toLowerCase()));

      const cleanAllowed = [...new Set(
        allowed_users
          .map(u => sanitizeIdToken(String(u)))
          .filter(u => {
            const lower = u.toLowerCase();
            return u && validUsers.has(lower) && (wsMembers.has(lower) || lower === 'admin' || (ws?.owner && lower === ws.owner.toLowerCase()));
          })
      )];

      project.allowed_users = cleanAllowed;
      saveProject(id, project);
      return { ok: true, allowed_users: cleanAllowed };
    });

    // Renomear projeto
    protectedRoutes.patch('/api/projects/:id', async (req, reply) => {
      const username = req.session.user.username;
      const { id } = req.params;
      const existing = loadProject(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }

      const ws = getWorkspace(existing.workspace) || getWorkspace('ws_default');
      if (!canManageProject(existing, ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para renomear este projeto.' });
      }

      const { title } = req.body || {};
      if (typeof title !== 'string' || !title.trim()) {
        return reply.code(400).send({ error: 'Título é obrigatório.' });
      }

      const updated = renameProject(id, title.trim());
      if (!updated) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }
      return updated;
    });

    // Excluir projeto
    protectedRoutes.delete('/api/projects/:id', async (req, reply) => {
      const username = req.session.user.username;
      const { id } = req.params;
      const existing = loadProject(id);
      if (!existing) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }

      const ws = getWorkspace(existing.workspace) || getWorkspace('ws_default');
      if (!canManageProject(existing, ws, username)) {
        return reply.code(403).send({ error: 'Sem permissão para excluir este projeto.' });
      }

      const deleted = deleteProject(id);
      if (!deleted) {
        return reply.code(404).send({ error: 'Projeto não encontrado.' });
      }
      return { ok: true };
    });

    // Upload de Imagens (Ctrl+V ou Arquivo) com whitelist estrita
    protectedRoutes.post('/api/attachments', async (req, reply) => {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'Nenhum arquivo enviado.' });
      }

      const mimeExt = ALLOWED_IMAGE_MIMES[data.mimetype];
      const origExt = path.extname(data.filename || '').toLowerCase();
      if (!mimeExt || (origExt && !ALLOWED_IMAGE_EXTS.has(origExt))) {
        data.file.resume();
        return reply.code(400).send({ error: 'Tipo de arquivo não permitido. Envie apenas imagens PNG, JPG, WEBP ou GIF.' });
      }

      if (!fs.existsSync(CONFIG.ATTACHMENTS_DIR)) {
        fs.mkdirSync(CONFIG.ATTACHMENTS_DIR, { recursive: true });
      }

      const ext = origExt && ALLOWED_IMAGE_EXTS.has(origExt) ? origExt : mimeExt;
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

    // --- Rotas de Configurações Gerais (Restrito ao Admin com senha) ---
    protectedRoutes.put('/api/settings', async (req, reply) => {
      const currentUsername = req.session?.user?.username || '';
      if (currentUsername.toLowerCase() !== 'admin') {
        return reply.code(403).send({ error: 'Apenas o administrador pode alterar o nome da aplicação.' });
      }

      const { appName, password } = req.body || {};
      if (typeof appName !== 'string' || !appName.trim()) {
        return reply.code(400).send({ error: 'Nome da aplicação inválido.' });
      }

      if (typeof password !== 'string' || !password) {
        return reply.code(400).send({ error: 'A senha do administrador é obrigatória para confirmar.' });
      }

      const verified = await verifyUser(currentUsername, password);
      if (!verified) {
        return reply.code(403).send({ error: 'Senha incorreta. Alteração não autorizada.' });
      }

      return updateSettings({ appName: appName.trim() });
    });

    // --- Rotas de Colaboradores (Etiquetas extras: gestão restrita a admins) ---
    protectedRoutes.get('/api/collaborators', async () => {
      return listCollaborators();
    });

    protectedRoutes.post('/api/collaborators', async (req, reply) => {
      const username = req.session.user.username;
      const canManage = isGlobalAdmin(username) || listWorkspaces().some(ws => canManageWorkspace(ws, username));
      if (!canManage) {
        return reply.code(403).send({ error: 'Apenas administradores podem adicionar colaboradores extras.' });
      }

      const { name, role, color } = req.body || {};
      if (typeof name !== 'string' || !name.trim()) {
        return reply.code(400).send({ error: 'Nome do colaborador é obrigatório.' });
      }
      const created = saveCollaborator({ name: name.trim(), role: role || 'Externo', color: color || '#e0f2fe' });
      return created;
    });

    protectedRoutes.delete('/api/collaborators/:id', async (req, reply) => {
      const username = req.session.user.username;
      const canManage = isGlobalAdmin(username) || listWorkspaces().some(ws => canManageWorkspace(ws, username));
      if (!canManage) {
        return reply.code(403).send({ error: 'Apenas administradores podem remover colaboradores extras.' });
      }

      const { id } = req.params;
      deleteCollaborator(id);
      return { ok: true };
    });
  });
}

