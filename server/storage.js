import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import crypto from 'crypto';
import { CONFIG } from './config.js';

/**
 * Sanitiza o ID/nome do projeto para evitar Path Traversal.
 */
export function sanitizeFilename(name) {
  const clean = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
  return clean ? `${clean}.md` : 'projeto-sem-titulo.md';
}

const DEFAULT_COLUMN_COLORS = ['col-blue', 'col-amber', 'col-green', 'col-purple', 'col-rose', 'col-gray'];

function sanitizeColumnColor(color) {
  if (typeof color !== 'string') return null;
  const trimmed = color.trim();
  if (DEFAULT_COLUMN_COLORS.includes(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return null;
}

/**
 * Converte um arquivo .md no formato do Kanban Obsidian para JSON estruturado.
 */
export function parseMarkdownKanban(rawMarkdown) {
  const { data: frontmatter, content } = matter(rawMarkdown);

  const lines = content.split('\n');
  const columns = [];
  let currentColumn = null;

  for (let line of lines) {
    const trimmed = line.trim();

    // Identifica colunas: cabeçalhos ## Nome da Coluna (com metadado opcional de cor)
    if (trimmed.startsWith('## ')) {
      let title = trimmed.replace(/^##\s+/, '').trim();
      let color = null;
      const colorMatch = title.match(/\s*<!--\s*color:\s*([^>\s]+)\s*-->\s*$/i);
      if (colorMatch) {
        color = sanitizeColumnColor(colorMatch[1]);
        title = title.replace(/\s*<!--\s*color:\s*([^>\s]+)\s*-->\s*$/i, '').trim();
      }
      currentColumn = {
        id: 'col_' + crypto.randomUUID().slice(0, 8),
        title,
        color: color || DEFAULT_COLUMN_COLORS[columns.length % DEFAULT_COLUMN_COLORS.length],
        cards: []
      };
      columns.push(currentColumn);
      continue;
    }

    // Identifica itens/cards: - [ ] ou - [x]
    if (currentColumn && (trimmed.startsWith('- [ ]') || trimmed.startsWith('- [x]'))) {
      const completed = trimmed.startsWith('- [x]');
      let cardText = trimmed.replace(/^- \[[ x]\]\s*/, '').trim();

      // Extrai data: 📅 YYYY-MM-DD
      let dueDate = null;
      const dateMatch = cardText.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        dueDate = dateMatch[1];
        cardText = cardText.replace(/📅\s*(\d{4}-\d{2}-\d{2})/, '').trim();
      }

      // Extrai múltiplos responsáveis: @(Nome) ou @Nome
      const assignees = [];
      const assigneeRegex = /@\(([^)]+)\)|@([\w.-]+)/g;
      let aMatch;
      while ((aMatch = assigneeRegex.exec(cardText)) !== null) {
        const name = (aMatch[1] || aMatch[2]).trim();
        if (name && !assignees.includes(name)) {
          assignees.push(name);
        }
      }
      if (assignees.length > 0) {
        cardText = cardText.replace(/@\(([^)]+)\)|@([\w.-]+)/g, '').trim();
      }

      // Extrai urgência
      let urgency = null;
      if (cardText.includes('🔺') || cardText.toLowerCase().includes('#alta')) {
        urgency = 'alta';
        cardText = cardText.replace(/🔺/g, '').replace(/#alta/gi, '').trim();
      } else if (cardText.includes('⏳') || cardText.toLowerCase().includes('#media')) {
        urgency = 'media';
        cardText = cardText.replace(/⏳/g, '').replace(/#media/gi, '').trim();
      } else if (cardText.includes('🌱') || cardText.toLowerCase().includes('#baixa')) {
        urgency = 'baixa';
        cardText = cardText.replace(/🌱/g, '').replace(/#baixa/gi, '').trim();
      }

      currentColumn.cards.push({
        id: 'card_' + crypto.randomUUID().slice(0, 8),
        content: cardText,
        urgency,
        dueDate,
        assignees, // array de nomes de responsáveis
        completed
      });
    }
  }

  const allowedUsers = Array.isArray(frontmatter.allowed_users)
    ? frontmatter.allowed_users.map(u => String(u).trim()).filter(Boolean)
    : [];

  return {
    title: frontmatter.title || 'Quadro',
    workspace: typeof frontmatter.workspace === 'string' && frontmatter.workspace.trim()
      ? frontmatter.workspace.trim()
      : 'ws_default',
    owner: typeof frontmatter.owner === 'string' && frontmatter.owner.trim()
      ? frontmatter.owner.trim()
      : 'admin',
    allowed_users: allowedUsers,
    columns
  };
}

/**
 * Converte a estrutura de colunas e cards de volta para Markdown padrão Obsidian Kanban.
 */
export function serializeMarkdownKanban(data) {
  const allowedUsers = Array.isArray(data.allowed_users)
    ? [...new Set(data.allowed_users.map(u => String(u).trim()).filter(Boolean))]
    : [];

  const frontmatter = {
    'kanban-plugin': 'basic',
    title: data.title || 'Quadro',
    workspace: data.workspace || 'ws_default',
    owner: data.owner || 'admin',
    allowed_users: allowedUsers
  };

  let mdContent = matter.stringify('', frontmatter);
  mdContent += '\n';

  for (const col of data.columns || []) {
    const safeColor = sanitizeColumnColor(col.color);
    const colorSuffix = safeColor ? ` <!-- color:${safeColor} -->` : '';
    mdContent += `## ${col.title}${colorSuffix}\n`;
    for (const card of col.cards || []) {
      const check = card.completed ? '- [x]' : '- [ ]';
      let text = card.content || '';

      if (card.dueDate) {
        text += ` 📅 ${card.dueDate}`;
      }

      if (Array.isArray(card.assignees) && card.assignees.length > 0) {
        card.assignees.forEach(name => {
          text += ` @(${name})`;
        });
      } else if (card.assignee) {
        text += ` @(${card.assignee})`;
      }

      if (card.urgency === 'alta') text += ' 🔺';
      else if (card.urgency === 'media') text += ' ⏳';
      else if (card.urgency === 'baixa') text += ' 🌱';

      mdContent += `${check} ${text}\n`;
    }
    mdContent += '\n';
  }

  return mdContent.trimEnd() + '\n';
}

/**
 * Lista todos os projetos disponíveis na pasta vaults.
 */
export function listProjects() {
  if (!fs.existsSync(CONFIG.VAULTS_DIR)) {
    fs.mkdirSync(CONFIG.VAULTS_DIR, { recursive: true });
  }

  const files = fs.readdirSync(CONFIG.VAULTS_DIR);
  return files
    .filter(file => file.endsWith('.md'))
    .map(file => {
      const filePath = path.join(CONFIG.VAULTS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(content);
      const allowedUsers = Array.isArray(data.allowed_users)
        ? data.allowed_users.map(u => String(u).trim()).filter(Boolean)
        : [];
      return {
        id: file.replace(/\.md$/, ''),
        filename: file,
        title: data.title || file.replace(/\.md$/, ''),
        workspace: typeof data.workspace === 'string' && data.workspace.trim() ? data.workspace.trim() : 'ws_default',
        owner: typeof data.owner === 'string' && data.owner.trim() ? data.owner.trim() : 'admin',
        allowed_users: allowedUsers
      };
    });
}

/**
 * Carrega e parseia um projeto pelo ID (nome sem .md).
 */
export function loadProject(id) {
  const filename = sanitizeFilename(id);
  const filePath = path.join(CONFIG.VAULTS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  return {
    id: id,
    ...parseMarkdownKanban(raw)
  };
}

/**
 * Salva um projeto no formato .md.
 */
export function saveProject(id, projectData) {
  const filename = sanitizeFilename(id);
  const filePath = path.join(CONFIG.VAULTS_DIR, filename);

  const raw = serializeMarkdownKanban(projectData);
  fs.writeFileSync(filePath, raw, 'utf-8');
  return true;
}

/**
 * Exclui um projeto (.md).
 */
export function deleteProject(id) {
  const filename = sanitizeFilename(id);
  const filePath = path.join(CONFIG.VAULTS_DIR, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Renomeia um projeto (.md e frontmatter).
 */
export function renameProject(id, newTitle) {
  const project = loadProject(id);
  if (!project) return null;

  project.title = newTitle;
  
  // Novo ID amigável
  const newId = newTitle.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'projeto';
  
  // Salva no novo arquivo
  saveProject(newId, project);

  // Se o ID mudou, remove o antigo
  if (newId !== id) {
    deleteProject(id);
  }

  return { id: newId, title: newTitle };
}

/**
 * Gestão de Configurações Gerais (Nome do App, etc)
 */
export function getSettings() {
  if (!fs.existsSync(CONFIG.SETTINGS_FILE)) {
    return { appName: '📋 Kanban' };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG.SETTINGS_FILE, 'utf-8'));
  } catch {
    return { appName: '📋 Kanban' };
  }
}

export function updateSettings(newSettings) {
  const current = getSettings();
  const merged = { ...current, ...newSettings };
  fs.writeFileSync(CONFIG.SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

/**
 * Gestão de Colaboradores
 */
export function listCollaborators() {
  if (!fs.existsSync(CONFIG.COLLABORATORS_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG.COLLABORATORS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function saveCollaborator(collaborator) {
  const list = listCollaborators();
  const index = list.findIndex(c => c.id === collaborator.id);
  if (index !== -1) {
    list[index] = { ...list[index], ...collaborator };
  } else {
    collaborator.id = collaborator.id || 'collab_' + crypto.randomUUID().slice(0, 8);
    list.push(collaborator);
  }
  fs.writeFileSync(CONFIG.COLLABORATORS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  return collaborator;
}

export function deleteCollaborator(id) {
  let list = listCollaborators();
  list = list.filter(c => c.id !== id);
  fs.writeFileSync(CONFIG.COLLABORATORS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  return true;
}

/**
 * Gestão de Workspaces & Autorização
 */
export function isGlobalAdmin(username) {
  return typeof username === 'string' && username.trim().toLowerCase() === 'admin';
}

export function sanitizeIdToken(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, '');
}

export function ensureDefaultWorkspace() {
  if (!fs.existsSync(CONFIG.WORKSPACES_FILE)) {
    return [];
  }
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.WORKSPACES_FILE, 'utf-8'));
    return Array.isArray(data.workspaces) ? data.workspaces : [];
  } catch {
    return [];
  }
}

export function listWorkspaces() {
  return ensureDefaultWorkspace();
}

export function getWorkspace(id) {
  const cleanId = sanitizeIdToken(id);
  if (!cleanId) return null;
  return listWorkspaces().find(w => w.id === cleanId) || null;
}

export function saveWorkspace(workspace) {
  const list = listWorkspaces();
  const idx = list.findIndex(w => w.id === workspace.id);
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...workspace };
  } else {
    list.push(workspace);
  }
  fs.writeFileSync(CONFIG.WORKSPACES_FILE, JSON.stringify({ workspaces: list }, null, 2), 'utf-8');
  return workspace;
}

export function deleteWorkspace(id) {
  const cleanId = sanitizeIdToken(id);
  if (!cleanId) return false;
  const list = listWorkspaces();
  const next = list.filter(w => w.id !== cleanId);
  if (next.length === list.length) return false;
  fs.writeFileSync(CONFIG.WORKSPACES_FILE, JSON.stringify({ workspaces: next }, null, 2), 'utf-8');
  return true;
}

export function getUserWorkspaceRole(ws, username) {
  if (!ws || !username) return null;
  if (isGlobalAdmin(username)) return 'owner';
  const lowerUser = username.toLowerCase();
  if (ws.owner && ws.owner.toLowerCase() === lowerUser) return 'owner';
  const member = Array.isArray(ws.members)
    ? ws.members.find(m => m.username && m.username.toLowerCase() === lowerUser)
    : null;
  if (!member) return null;
  return member.role === 'admin' ? 'admin' : 'member';
}

export function canManageWorkspace(ws, username) {
  const role = getUserWorkspaceRole(ws, username);
  return role === 'owner' || role === 'admin';
}

export function canAccessProject(projectMeta, ws, username) {
  if (!projectMeta || !username) return false;
  if (isGlobalAdmin(username)) return true;

  const lowerUser = username.toLowerCase();
  const role = getUserWorkspaceRole(ws, username);
  if (!role) return false;

  if (role === 'owner' || role === 'admin') return true;
  if (projectMeta.owner && projectMeta.owner.toLowerCase() === lowerUser) return true;

  return Array.isArray(projectMeta.allowed_users) &&
    projectMeta.allowed_users.some(u => typeof u === 'string' && u.toLowerCase() === lowerUser);
}

export function canManageProject(projectMeta, ws, username) {
  if (!projectMeta || !username) return false;
  if (isGlobalAdmin(username)) return true;
  const role = getUserWorkspaceRole(ws, username);
  if (role === 'owner' || role === 'admin') return true;
  return Boolean(projectMeta.owner && projectMeta.owner.toLowerCase() === username.toLowerCase());
}

