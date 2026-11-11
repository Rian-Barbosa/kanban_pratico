import { renderCardMarkdown, escapeHtml } from './markdown.js';

let currentProject = null;
let activeDraggingCard = null;
let dragSourceColId = null;

export async function initKanban() {
  loadCustomAppName();
  await checkAuth();
  await loadCollaborators();
  await loadProjectList();
  setupGlobalClipboardPaste();
  setupVisualEditorLiveKeys();
}

async function loadCustomAppName() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.appName) {
        localStorage.setItem('kanban_custom_app_name', data.appName);
      }
    }
  } catch {}

  const customName = localStorage.getItem('kanban_custom_app_name') || '📋 Kanban';
  const brandEl = document.getElementById('app-brand-name');
  if (brandEl) brandEl.textContent = customName;
  document.title = customName.replace(/[^\w\s-]/gi, '').trim() || 'Kanban';
}

// Sistema assíncrono de Confirmação via Modal (substitui window.confirm)
let pendingConfirmResolve = null;

function showConfirmModal(message, title = '⚠️ Confirmação') {
  return new Promise((resolve) => {
    pendingConfirmResolve = resolve;
    document.getElementById('generic-confirm-title').textContent = title;
    document.getElementById('generic-confirm-msg').textContent = message;
    document.getElementById('generic-confirm-modal').style.display = 'flex';
  });
}

window.closeGenericConfirmModal = function (confirmed) {
  document.getElementById('generic-confirm-modal').style.display = 'none';
  if (pendingConfirmResolve) {
    pendingConfirmResolve(confirmed);
    pendingConfirmResolve = null;
  }
};

// Modal de Criação / Edição de Projeto e Nome do App (substitui window.prompt)
let projectInputMode = null; // 'create_project' | 'rename_project' | 'rename_app'

window.promptChangeAppName = function () {
  projectInputMode = 'rename_app';
  const current = localStorage.getItem('kanban_custom_app_name') || '📋 Kanban';
  document.getElementById('project-input-modal-title').textContent = 'Nome da Aplicação';
  document.getElementById('project-input-label').textContent = 'Personalizar Título do Kanban';
  document.getElementById('project-name-input').value = current;
  document.getElementById('save-project-input-btn').textContent = 'Salvar Nome';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.openNewProjectPrompt = function () {
  projectInputMode = 'create_project';
  document.getElementById('project-input-modal-title').textContent = 'Novo Projeto';
  document.getElementById('project-input-label').textContent = 'Nome do Projeto / Quadro';
  document.getElementById('project-name-input').value = '';
  document.getElementById('project-name-input').placeholder = 'Ex: Roadmap 2026, Finanças...';
  document.getElementById('save-project-input-btn').textContent = 'Criar Projeto';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.promptRenameCurrentProject = function () {
  if (!currentProject) return;
  projectInputMode = 'rename_project';
  document.getElementById('project-input-modal-title').textContent = 'Renomear Projeto';
  document.getElementById('project-input-label').textContent = 'Novo Nome do Projeto';
  document.getElementById('project-name-input').value = currentProject.title;
  document.getElementById('save-project-input-btn').textContent = 'Salvar Alteração';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.closeProjectInputModal = function () {
  document.getElementById('project-input-modal').style.display = 'none';
  projectInputMode = null;
};

window.saveProjectInputAction = async function () {
  const val = document.getElementById('project-name-input').value.trim();
  if (!val) return;

  if (projectInputMode === 'rename_app') {
    localStorage.setItem('kanban_custom_app_name', val);
    const brandEl = document.getElementById('app-brand-name');
    if (brandEl) brandEl.textContent = val;
    document.title = val.replace(/[^\w\s-]/gi, '').trim() || 'Kanban';
    
    // Salva de forma persistente no servidor local (data/settings.json)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: val })
      });
    } catch {}

    closeProjectInputModal();
  } else if (projectInputMode === 'create_project') {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: val })
    });
    if (res.ok) {
      const proj = await res.json();
      closeProjectInputModal();
      await loadProjectList();
      selectProject(proj.id);
    }
  } else if (projectInputMode === 'rename_project' && currentProject) {
    if (val === currentProject.title) {
      closeProjectInputModal();
      return;
    }
    const res = await fetch(`/api/projects/${currentProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: val })
    });
    if (res.ok) {
      const updated = await res.json();
      closeProjectInputModal();
      await loadProjectList();
      selectProject(updated.id);
    }
  }
};

window.promptChangeAppName = function () {
  const current = localStorage.getItem('kanban_custom_app_name') || '📋 Kanban';
  document.getElementById('project-input-modal-title').textContent = 'Nome da Aplicação';
  document.getElementById('project-input-label').textContent = 'Personalizar Título do Kanban';
  document.getElementById('project-name-input').value = current;
  document.getElementById('save-project-input-btn').textContent = 'Salvar Nome';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.openNewProjectPrompt = function () {
  projectInputMode = 'create_project';
  document.getElementById('project-input-modal-title').textContent = 'Novo Projeto';
  document.getElementById('project-input-label').textContent = 'Nome do Projeto / Quadro';
  document.getElementById('project-name-input').value = '';
  document.getElementById('project-name-input').placeholder = 'Ex: Roadmap 2026, Finanças...';
  document.getElementById('save-project-input-btn').textContent = 'Criar Projeto';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.promptRenameCurrentProject = function () {
  if (!currentProject) return;
  projectInputMode = 'rename_project';
  document.getElementById('project-input-modal-title').textContent = 'Renomear Projeto';
  document.getElementById('project-input-label').textContent = 'Novo Nome do Projeto';
  document.getElementById('project-name-input').value = currentProject.title;
  document.getElementById('save-project-input-btn').textContent = 'Salvar Alteração';
  document.getElementById('project-input-modal').style.display = 'flex';
  document.getElementById('project-name-input').focus();
};

window.closeProjectInputModal = function () {
  document.getElementById('project-input-modal').style.display = 'none';
  projectInputMode = null;
};

window.saveProjectInputAction = async function () {
  const val = document.getElementById('project-name-input').value.trim();
  if (!val) return;

  if (projectInputMode === 'rename_app') {
    localStorage.setItem('kanban_custom_app_name', val);
    const brandEl = document.getElementById('app-brand-name');
    if (brandEl) brandEl.textContent = val;
    document.title = val.replace(/[^\w\s-]/gi, '').trim() || 'Kanban';
    
    // Salva de forma persistente no servidor local (data/settings.json)
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName: val })
      });
    } catch {}

    closeProjectInputModal();
  } else if (projectInputMode === 'create_project') {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: val })
    });
    if (res.ok) {
      const proj = await res.json();
      closeProjectInputModal();
      await loadProjectList();
      selectProject(proj.id);
    }
  } else if (projectInputMode === 'rename_project' && currentProject) {
    if (val === currentProject.title) {
      closeProjectInputModal();
      return;
    }
    const res = await fetch(`/api/projects/${currentProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: val })
    });
    if (res.ok) {
      const updated = await res.json();
      closeProjectInputModal();
      await loadProjectList();
      selectProject(updated.id);
    }
  }
};

async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.authenticated) {
      document.getElementById('login-modal').style.display = 'flex';
    } else {
      document.getElementById('login-modal').style.display = 'none';
      document.getElementById('user-display').textContent = data.user.username;
    }
  } catch (err) {
    console.error(err);
  }
}

// Handler de Login
window.handleLogin = async function (e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (res.ok) {
      document.getElementById('login-modal').style.display = 'none';
      await loadProjectList();
    } else {
      const data = await res.json();
      errorEl.textContent = data.error || 'Credenciais inválidas';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = 'Erro ao conectar ao servidor';
    errorEl.style.display = 'block';
  }
};

window.handleLogout = async function () {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
};

export async function loadProjectList() {
  const res = await fetch('/api/projects');
  if (res.status === 401) {
    document.getElementById('login-modal').style.display = 'flex';
    return;
  }
  const projects = await res.json();
  const listEl = document.getElementById('project-list');
  listEl.innerHTML = '';

  const headerInfo = document.getElementById('project-header-info');
  const headerActions = document.getElementById('project-header-actions');
  const boardEl = document.getElementById('kanban-board');

  if (projects.length === 0) {
    currentProject = null;
    if (headerInfo) headerInfo.style.display = 'none';
    if (headerActions) headerActions.style.display = 'none';
    if (boardEl) {
      boardEl.innerHTML = `
        <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 70vh; color: var(--text-muted); text-align: center;">
          <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 8px;">Nenhum quadro selecionado</p>
          <p style="font-size: 0.85rem; margin-bottom: 16px;">Crie um novo projeto na barra lateral para começar a organizar suas tarefas.</p>
          <button class="btn btn-primary" onclick="openNewProjectPrompt()">+ Criar Primeiro Projeto</button>
        </div>
      `;
    }
    return;
  }

  projects.forEach((proj, idx) => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.textContent = `📋 ${proj.title}`;
    li.onclick = () => selectProject(proj.id);
    listEl.appendChild(li);

    if (idx === 0 && !currentProject) {
      selectProject(proj.id);
    }
  });
}

export async function selectProject(id) {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) return;

  currentProject = await res.json();

  const headerInfo = document.getElementById('project-header-info');
  const headerActions = document.getElementById('project-header-actions');
  const titleEl = document.getElementById('current-project-title');

  if (headerInfo) headerInfo.style.display = 'flex';
  if (headerActions) headerActions.style.display = 'flex';
  if (titleEl) titleEl.textContent = currentProject.title;

  // Atualiza classe ativa na sidebar
  const items = document.querySelectorAll('.project-item');
  items.forEach(item => {
    if (item.textContent.includes(currentProject.title)) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  renderBoard();
}

const PASTEL_COLUMN_CLASSES = ['col-blue', 'col-amber', 'col-green', 'col-purple', 'col-rose'];

export function renderBoard() {
  const boardEl = document.getElementById('kanban-board');
  boardEl.innerHTML = '';

  if (!currentProject || !currentProject.columns) return;

  currentProject.columns.forEach((col, idx) => {
    const colorClass = PASTEL_COLUMN_CLASSES[idx % PASTEL_COLUMN_CLASSES.length];
    const colEl = document.createElement('div');
    colEl.className = `kanban-column ${colorClass}`;
    colEl.dataset.colId = col.id;

    const safeTitle = escapeHtml(col.title);
    colEl.innerHTML = `
      <div class="column-header">
        <span class="column-title" style="cursor: pointer;" title="Clique duplo para renomear a lista">
          ${safeTitle} <span class="card-count">${col.cards.length}</span>
        </span>
        <div style="display: flex; align-items: center; gap: 4px;">
          <button class="card-action-btn" title="Editar nome da lista" onclick="openEditColumnModal('${col.id}')">✏️</button>
          <button class="card-action-btn delete" title="Excluir lista" onclick="deleteColumn('${col.id}')">🗑️</button>
          <button class="btn" style="padding: 2px 6px; font-size: 0.75rem; margin-left: 2px;" onclick="openNewCardModal('${col.id}')" title="Adicionar Item">+</button>
        </div>
      </div>
      <div class="card-list" data-col-id="${col.id}"></div>
    `;

    // Duplo clique no título da coluna também abre edição
    const titleEl = colEl.querySelector('.column-title');
    titleEl.addEventListener('dblclick', () => openEditColumnModal(col.id));

    const cardListEl = colEl.querySelector('.card-list');

    // Drag-and-Drop Handlers para a Coluna
    cardListEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      cardListEl.style.background = 'rgba(55, 53, 47, 0.05)';
    });

    cardListEl.addEventListener('dragleave', () => {
      cardListEl.style.background = '';
    });

    cardListEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      cardListEl.style.background = '';
      if (!activeDraggingCard) return;

      const targetColId = col.id;
      if (dragSourceColId === targetColId) return;

      // Move o card entre as colunas no estado
      const sourceCol = currentProject.columns.find(c => c.id === dragSourceColId);
      const targetCol = currentProject.columns.find(c => c.id === targetColId);

      const cardIdx = sourceCol.cards.findIndex(c => c.id === activeDraggingCard.id);
      if (cardIdx !== -1) {
        const [movedCard] = sourceCol.cards.splice(cardIdx, 1);
        targetCol.cards.push(movedCard);
        await syncProject();
        renderBoard();
      }
    });

    // Renderiza cada card
    col.cards.forEach(card => {
      const cardEl = document.createElement('div');
      cardEl.className = 'kanban-card';
      cardEl.draggable = true;
      cardEl.dataset.cardId = card.id;

      let badgesHtml = '';
      const assignees = Array.isArray(card.assignees) 
        ? card.assignees 
        : (card.assignee ? [card.assignee] : []);

      assignees.forEach(name => {
        badgesHtml += `<span class="badge-pill badge-assignee">👤 ${escapeHtml(name)}</span>`;
      });

      if (card.urgency) {
        const icons = { alta: '🔺 Alta', media: '⏳ Média', baixa: '🌱 Baixa' };
        badgesHtml += `<span class="badge-pill badge-${card.urgency}">${icons[card.urgency] || card.urgency}</span>`;
      }
      if (card.dueDate) {
        badgesHtml += `<span class="badge-pill badge-date">📅 ${card.dueDate}</span>`;
      }

      cardEl.innerHTML = `
        <div class="card-header-actions">
          <button class="card-action-btn" title="Editar" onclick="openEditCardModal('${col.id}', '${card.id}')">✏️</button>
          <button class="card-action-btn delete" title="Excluir" onclick="deleteCard('${col.id}', '${card.id}', event)">🗑️</button>
        </div>
        <div class="card-markdown">${renderCardMarkdown(card.content)}</div>
        ${badgesHtml ? `<div class="card-meta">${badgesHtml}</div>` : ''}
      `;

      // Clique duplo no card também abre edição
      cardEl.addEventListener('dblclick', (e) => {
        if (e.target.tagName !== 'IMG' && !e.target.closest('.card-header-actions')) {
          openEditCardModal(col.id, card.id);
        }
      });

      // Clique em qualquer imagem do card abre o visualizador Lightbox
      cardEl.querySelectorAll('.card-markdown img').forEach(img => {
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          openLightbox(img.src);
        });
      });

      // Animação e eventos de Drag
      cardEl.addEventListener('dragstart', (e) => {
        activeDraggingCard = card;
        dragSourceColId = col.id;
        cardEl.classList.add('dragging');
        e.dataTransfer.setData('text/plain', card.id);
      });

      cardEl.addEventListener('dragend', () => {
        cardEl.classList.remove('dragging');
        activeDraggingCard = null;
        dragSourceColId = null;
      });

      cardListEl.appendChild(cardEl);
    });

    boardEl.appendChild(colEl);
  });
}

// Alternância de Checklist clicável diretamente no card (como no Obsidian)
window.handleTaskToggle = async function (e, checkboxEl) {
  e.stopPropagation();
  const cardEl = checkboxEl.closest('.kanban-card');
  const colEl = checkboxEl.closest('.kanban-column');
  if (!cardEl || !colEl || !currentProject) return;

  const colId = colEl.dataset.colId;
  const cardId = cardEl.dataset.cardId;

  const col = currentProject.columns.find(c => c.id === colId);
  if (!col) return;
  const card = col.cards.find(c => c.id === cardId);
  if (!card) return;

  const lineIdx = parseInt(checkboxEl.dataset.taskIdx, 10);
  const lines = card.content.split('\n');

  if (lines[lineIdx] !== undefined) {
    if (checkboxEl.checked) {
      lines[lineIdx] = lines[lineIdx].replace(/^([\t ]*-\s*\[)\s*(\])/, '$1x$2');
    } else {
      lines[lineIdx] = lines[lineIdx].replace(/^([\t ]*-\s*\[)[xX](\])/, '$1 $2');
    }
    card.content = lines.join('\n');
    await syncProject();
    renderBoard();
  }
};

// Ação dinâmica para Wikilinks [[Nome]]
window.handleWikilinkClick = async function (e, el) {
  e.stopPropagation();
  const target = el.dataset.target;
  if (!target) return;

  // Verifica se existe um projeto com esse nome
  const res = await fetch('/api/projects');
  if (res.ok) {
    const list = await res.json();
    const match = list.find(p => p.title.toLowerCase() === target.toLowerCase() || p.id.toLowerCase() === target.toLowerCase());
    if (match) {
      selectProject(match.id);
      return;
    }
  }

  // Se não existir projeto com esse nome, pergunta se deseja criá-lo
  const confirmed = await showConfirmModal(`O projeto "${target}" ainda não existe. Deseja criá-lo agora?`, 'Criar Novo Projeto');
  if (confirmed) {
    const createRes = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: target })
    });
    if (createRes.ok) {
      const newProj = await createRes.json();
      await loadProjectList();
      selectProject(newProj.id);
    }
  }
};

// Ação dinâmica para Tags #tag (Filtro rápido visual de cards)
let activeFilterTag = null;

window.handleTagClick = function (e, el) {
  e.stopPropagation();
  const tag = el.dataset.tag;
  if (!tag) return;

  if (activeFilterTag === tag) {
    // Desativa filtro
    activeFilterTag = null;
    document.querySelectorAll('.kanban-card').forEach(c => c.style.display = '');
  } else {
    // Aplica filtro
    activeFilterTag = tag;
    document.querySelectorAll('.kanban-card').forEach(card => {
      const tags = card.querySelectorAll('.md-tag');
      const hasTag = Array.from(tags).some(t => t.dataset.tag === tag);
      card.style.display = hasTag ? '' : 'none';
    });
  }
};

// Sincroniza estado com o backend
export async function syncProject() {
  if (!currentProject) return;
  await fetch(`/api/projects/${currentProject.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentProject)
  });
}

// Exclusão de Projeto
window.confirmDeleteCurrentProject = function () {
  if (!currentProject) return;
  document.getElementById('delete-project-name').textContent = `"${currentProject.title}"`;
  document.getElementById('confirm-delete-modal').style.display = 'flex';
};

window.closeConfirmDeleteModal = function () {
  document.getElementById('confirm-delete-modal').style.display = 'none';
};

window.executeDeleteCurrentProject = async function () {
  if (!currentProject) return;
  const res = await fetch(`/api/projects/${currentProject.id}`, { method: 'DELETE' });
  if (res.ok) {
    closeConfirmDeleteModal();
    currentProject = null;
    await loadProjectList();
  }
};

// --- Gestão de Colunas (Listas) ---
let editingColumnId = null;

window.openNewColumnModal = function () {
  editingColumnId = null;
  document.getElementById('column-modal-title').textContent = 'Nova Lista';
  document.getElementById('save-column-btn').textContent = 'Adicionar Lista';
  document.getElementById('column-title-input').value = '';
  document.getElementById('column-modal').style.display = 'flex';
  document.getElementById('column-title-input').focus();
};

window.openEditColumnModal = function (colId) {
  if (!currentProject) return;
  const col = currentProject.columns.find(c => c.id === colId);
  if (!col) return;

  editingColumnId = colId;
  document.getElementById('column-modal-title').textContent = 'Editar Lista';
  document.getElementById('save-column-btn').textContent = 'Salvar Alterações';
  document.getElementById('column-title-input').value = col.title;
  document.getElementById('column-modal').style.display = 'flex';
  document.getElementById('column-title-input').focus();
};

window.closeColumnModal = function () {
  document.getElementById('column-modal').style.display = 'none';
  editingColumnId = null;
};

window.saveColumnAction = async function () {
  const title = document.getElementById('column-title-input').value.trim();
  if (!title || !currentProject) return;

  if (editingColumnId) {
    const col = currentProject.columns.find(c => c.id === editingColumnId);
    if (col) {
      col.title = title;
    }
  } else {
    currentProject.columns.push({
      id: 'col_' + Math.random().toString(36).substring(2, 9),
      title,
      cards: []
    });
  }

  await syncProject();
  renderBoard();
  closeColumnModal();
};

window.deleteColumn = async function (colId) {
  if (!currentProject) return;
  const col = currentProject.columns.find(c => c.id === colId);
  if (!col) return;

  const msg = col.cards.length > 0
    ? `A lista "${col.title}" contém ${col.cards.length} item(ns). Deseja realmente excluí-la com todos os seus cards?`
    : `Deseja excluir a lista "${col.title}"?`;

  const confirmed = await showConfirmModal(msg, 'Excluir Lista');
  if (!confirmed) return;

  currentProject.columns = currentProject.columns.filter(c => c.id !== colId);
  await syncProject();
  renderBoard();
};

let collaboratorsList = [];

export async function loadCollaborators() {
  try {
    const res = await fetch('/api/collaborators');
    if (res.ok) {
      collaboratorsList = await res.json();
    }
  } catch (err) {
    console.error('Erro ao carregar colaboradores:', err);
  }
}

function renderAssigneesSelection(selectedNames = []) {
  const container = document.getElementById('card-assignees-container');
  if (!container) return;

  container.innerHTML = '';

  if (collaboratorsList.length === 0) {
    container.innerHTML = '<span style="font-size: 0.78rem; color: var(--text-muted);">Nenhum colaborador cadastrado.</span>';
    return;
  }

  collaboratorsList.forEach(collab => {
    const label = document.createElement('label');
    const isSelected = selectedNames.includes(collab.name);
    label.className = `assignee-chip-label ${isSelected ? 'selected' : ''}`;

    label.innerHTML = `
      <input type="checkbox" value="${collab.name}" ${isSelected ? 'checked' : ''} />
      <span>👤 ${collab.name}</span>
    `;

    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        label.classList.add('selected');
      } else {
        label.classList.remove('selected');
      }
    });

    container.appendChild(label);
  });
}

function getSelectedAssignees() {
  const container = document.getElementById('card-assignees-container');
  if (!container) return [];
  const checked = container.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checked).map(cb => cb.value);
}

window.openCollaboratorsModal = async function () {
  await loadCollaborators();
  renderCollaboratorsList();
  document.getElementById('collaborators-modal').style.display = 'flex';
};

window.closeCollaboratorsModal = function () {
  document.getElementById('collaborators-modal').style.display = 'none';
};

function renderCollaboratorsList() {
  const container = document.getElementById('collaborators-list');
  if (!container) return;

  if (collaboratorsList.length === 0) {
    container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; padding: 12px;">Nenhum colaborador cadastrado ainda.</p>';
    return;
  }

  container.innerHTML = '';
  collaboratorsList.forEach(c => {
    const item = document.createElement('div');
    item.className = 'collab-item';
    const initial = (c.name || '?')[0].toUpperCase();

    const safeName = escapeHtml(c.name);
    const safeRole = escapeHtml(c.role || 'Membro');
    item.innerHTML = `
      <div style="display: flex; align-items: center;">
        <div class="collab-avatar">${initial}</div>
        <div>
          <div style="font-size: 0.88rem; font-weight: 600;">${safeName}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted);">${safeRole}</div>
        </div>
      </div>
      <button class="card-action-btn delete" onclick="handleDeleteCollaborator('${c.id}')" title="Remover">🗑️</button>
    `;
    container.appendChild(item);
  });
}

window.handleCreateCollaborator = async function (e) {
  e.preventDefault();
  const nameInput = document.getElementById('new-collab-name');
  const roleInput = document.getElementById('new-collab-role');

  const name = nameInput.value.trim();
  const role = roleInput.value.trim();
  if (!name) return;

  const res = await fetch('/api/collaborators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, role })
  });

  if (res.ok) {
    nameInput.value = '';
    roleInput.value = '';
    await loadCollaborators();
    renderCollaboratorsList();
  }
};

window.handleDeleteCollaborator = async function (id) {
  const confirmed = await showConfirmModal('Deseja realmente remover este colaborador da equipe?', 'Remover Colaborador');
  if (!confirmed) return;
  const res = await fetch(`/api/collaborators/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadCollaborators();
    renderCollaboratorsList();
  }
};

let editingCardId = null;

// --- Alternância de Modos do Editor Markdown: Visual vs Texto Puro ---
let currentEditorMode = localStorage.getItem('kanban_editor_mode') === 'raw' ? 'raw' : 'live';
let savedVisualRange = null;
let savedRawSelection = null;

function stripZws(str) {
  return (str || '').replace(/\u200B/g, '');
}

function saveEditorSelection() {
  const visual = document.getElementById('card-content-visual');
  const textarea = document.getElementById('card-content-input');

  if (currentEditorMode === 'live' && visual) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (visual.contains(range.commonAncestorContainer)) {
        savedVisualRange = range.cloneRange();
      }
    }
  } else if (textarea) {
    savedRawSelection = {
      start: textarea.selectionStart || 0,
      end: textarea.selectionEnd || 0
    };
  }
}

export function switchEditorMode(mode) {
  currentEditorMode = mode === 'raw' ? 'raw' : 'live';
  localStorage.setItem('kanban_editor_mode', currentEditorMode);
  savedVisualRange = null;
  savedRawSelection = null;

  const wrapper = document.getElementById('card-editor-wrapper');
  if (wrapper) {
    wrapper.className = `editor-mode-${currentEditorMode}`;
  }

  const btnLive = document.getElementById('btn-mode-live');
  const btnRaw = document.getElementById('btn-mode-raw');
  if (btnLive && btnRaw) {
    if (currentEditorMode === 'live') {
      btnLive.classList.add('active');
      btnRaw.classList.remove('active');
    } else {
      btnRaw.classList.add('active');
      btnLive.classList.remove('active');
    }
  }

  const textarea = document.getElementById('card-content-input');
  const visual = document.getElementById('card-content-visual');

  if (currentEditorMode === 'live') {
    if (textarea && visual) {
      visual.innerHTML = renderVisualEditorHtml(textarea.value || '');
      visual.focus();
    }
  } else {
    if (visual && textarea) {
      textarea.value = visualEditorToMarkdown(visual);
      textarea.focus();
    }
  }
}

window.switchEditorMode = switchEditorMode;

// Formata marcações inline protegendo código inline e anexos
function renderInlineVisualHtml(rawLine) {
  if (!rawLine) return '';

  const codeTokens = [];
  let text = escapeHtml(rawLine);

  // Protege código inline (`...`)
  text = text.replace(/`([^`\n]+)`/g, (m, code) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code class="md-inline-code">${code}</code>`);
    return `\u0000IC${idx}\u0000`;
  });

  // Protege anexos (![[arquivo]] ou ![[arquivo|largura]])
  text = text.replace(/!\[\[(.*?)\]\]/g, (m, inner) => {
    const idx = codeTokens.length;
    const fname = inner.split('|')[0].trim();
    codeTokens.push(`<span class="md-attachment-token" contenteditable="false" data-raw="![[${inner}]]">🖼️ ${fname}</span>`);
    return `\u0000IC${idx}\u0000`;
  });

  // Wikilinks [[Nota]]
  text = text.replace(/\[\[(.*?)\]\]/g, (m, inner) => {
    return `<span class="md-wikilink" data-wikilink="1"><span class="vl-wikilink-icon" contenteditable="false">📄 </span><span class="vl-wikilink-text">${inner}</span></span>`;
  });

  // Links externos [texto](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
    return `<span class="md-link-inline"><span class="md-link-bracket" contenteditable="false">[</span><span class="md-link-text">${label}</span><span class="md-link-bracket" contenteditable="false">](</span><span class="md-link-url">${url}</span><span class="md-link-bracket" contenteditable="false">)</span></span>`;
  });

  // Destaque, Tachado, Negrito, Itálico
  text = text.replace(/==(.*?)==/g, '<mark class="md-highlight">$1</mark>');
  text = text.replace(/~~(.*?)~~/g, '<del class="md-strikethrough">$1</del>');
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // Tags inline (#tag)
  text = text.replace(/(^|\s)(#[a-zA-Z0-9_\-\/]+)(?=\s|$|[.,;:!?])/g, '$1<span class="md-tag">$2</span>');

  // Restaura tokens protegidos
  text = text.replace(/\u0000IC(\d+)\u0000/g, (m, idx) => codeTokens[Number(idx)] || '');

  return text;
}

function getLineIndentLevel(rawLine) {
  const leading = (rawLine.match(/^[\t ]*/) || [''])[0];
  let levels = 0;
  let spaceRun = 0;
  for (const ch of leading) {
    if (ch === '\t') {
      levels += 1 + Math.floor(spaceRun / 2);
      spaceRun = 0;
    } else {
      spaceRun += 1;
    }
  }
  levels += Math.floor(spaceRun / 2);
  return Math.min(levels, 10);
}

function setVisualLineIndent(lineEl, indent) {
  const clamped = Math.max(0, Math.min(indent, 10));
  if (clamped > 0) {
    lineEl.dataset.indent = String(clamped);
    lineEl.style.marginLeft = `${clamped * 24}px`;
  } else {
    delete lineEl.dataset.indent;
    lineEl.style.marginLeft = '';
  }
}

// Converte texto Markdown completo em HTML interativo para o editor visual
function renderVisualEditorHtml(markdownText) {
  if (!markdownText || !markdownText.trim()) return '';
  const lines = markdownText.split('\n');
  const out = [];
  let inCodeBlock = false;
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bloco de código ```
    if (!inCodeBlock && /^```/.test(line.trim())) {
      inCodeBlock = true;
      codeLines = [];
      continue;
    }
    if (inCodeBlock) {
      if (/^```/.test(line.trim())) {
        inCodeBlock = false;
        out.push(`<div class="visual-line md-code-block" data-code-block="true">${escapeHtml(codeLines.join('\n')) || '\u200B'}</div>`);
        continue;
      }
      codeLines.push(line);
      continue;
    }

    // Linha horizontal
    if (/^(\*{3,}|-{3,})$/.test(line.trim())) {
      out.push(`<div class="visual-line md-visual-hr" contenteditable="false"><hr class="md-hr" /></div>`);
      continue;
    }

    const indent = getLineIndentLevel(line);
    const indentAttr = indent > 0 ? ` data-indent="${indent}" style="margin-left: ${indent * 24}px;"` : '';
    const trimmedStart = line.replace(/^[\t ]+/, '');

    // Checklist (- [ ] ou - [x]) com suporte a indentação
    if (/^-\s*\[ \]\s*(.*)$/.test(trimmedStart)) {
      const text = trimmedStart.replace(/^-\s*\[ \]\s*/, '');
      out.push(`<div class="visual-line md-task-item"${indentAttr}><span class="visual-check-wrap" contenteditable="false"><input type="checkbox" class="md-task-checkbox" /></span><span class="visual-line-text">${renderInlineVisualHtml(text) || '\u200B'}</span></div>`);
      continue;
    }
    if (/^-\s*\[[xX]\]\s*(.*)$/.test(trimmedStart)) {
      const text = trimmedStart.replace(/^-\s*\[[xX]\]\s*/, '');
      out.push(`<div class="visual-line md-task-item completed"${indentAttr}><span class="visual-check-wrap" contenteditable="false"><input type="checkbox" checked class="md-task-checkbox" /></span><span class="visual-line-text">${renderInlineVisualHtml(text) || '\u200B'}</span></div>`);
      continue;
    }

    // Callout (> [!tipo] título)
    const calloutMatch = trimmedStart.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/);
    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase();
      const title = calloutMatch[2] || '';
      out.push(`<div class="visual-line md-callout callout-${escapeHtml(type)}" data-callout-type="${escapeHtml(type)}"><span class="visual-callout-badge" contenteditable="false">💡 [${escapeHtml(type)}] </span><span class="visual-line-text">${renderInlineVisualHtml(title) || '\u200B'}</span></div>`);
      continue;
    }

    // Blockquote (> texto)
    if (/^>\s*(.*)$/.test(trimmedStart)) {
      const content = trimmedStart.replace(/^>\s*/, '');
      out.push(`<div class="visual-line md-blockquote"><span class="visual-line-text">${renderInlineVisualHtml(content) || '\u200B'}</span></div>`);
      continue;
    }

    // Cabeçalhos (# a ######)
    const headingMatch = trimmedStart.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<div class="visual-line md-visual-heading md-h${level}" data-heading-level="${level}">${renderInlineVisualHtml(headingMatch[2]) || '\u200B'}</div>`);
      continue;
    }

    // Lista não-ordenada (- item ou * item) com suporte a indentação
    if (/^[-*+]\s+(.*)$/.test(trimmedStart)) {
      const content = trimmedStart.replace(/^[-*+]\s+/, '');
      out.push(`<div class="visual-line md-list-item"${indentAttr}><span class="visual-bullet" contenteditable="false">• </span><span class="visual-line-text">${renderInlineVisualHtml(content) || '\u200B'}</span></div>`);
      continue;
    }

    const inlineHtml = renderInlineVisualHtml(line);
    out.push(`<div class="visual-line">${inlineHtml || '<br>'}</div>`);
  }

  if (inCodeBlock) {
    out.push(`<div class="visual-line md-code-block" data-code-block="true">${escapeHtml(codeLines.join('\n')) || '\u200B'}</div>`);
  }

  return out.join('');
}

// Serializa nós inline do editor visual de volta para Markdown
function serializeVisualInlineNodes(container) {
  let result = '';
  container.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += stripZws(node.textContent).replace(/\u00a0/g, ' ');
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const cl = node.classList;
      if (cl.contains('visual-check-wrap') || cl.contains('visual-bullet') || cl.contains('visual-callout-badge') || cl.contains('vl-wikilink-icon') || cl.contains('md-link-bracket')) {
        return;
      }
      if (node.tagName === 'BR') {
        return;
      }
      if (cl.contains('md-attachment-token')) {
        result += node.dataset.raw || node.textContent;
        return;
      }
      if (cl.contains('md-link-inline')) {
        const label = stripZws(node.querySelector('.md-link-text')?.textContent || '');
        const url = stripZws(node.querySelector('.md-link-url')?.textContent || '');
        result += `[${label}](${url})`;
        return;
      }
      if (node.tagName === 'A') {
        const label = serializeVisualInlineNodes(node);
        const href = node.getAttribute('href') || '';
        result += `[${label}](${href})`;
        return;
      }
      if (cl.contains('md-wikilink')) {
        const target = stripZws(node.querySelector('.vl-wikilink-text')?.textContent ?? node.textContent.replace(/^📄\s*/, '')).replace(/\u00a0/g, ' ');
        result += `[[${target}]]`;
        return;
      }
      if (cl.contains('md-tag')) {
        const tagText = stripZws(node.textContent).replace(/\u00a0/g, ' ').trim();
        result += tagText.startsWith('#') ? tagText : `#${tagText}`;
        return;
      }
      if (cl.contains('md-highlight') || node.tagName === 'MARK') {
        result += `==${serializeVisualInlineNodes(node)}==`;
        return;
      }
      if (cl.contains('md-strikethrough') || node.tagName === 'DEL' || node.tagName === 'S' || node.tagName === 'STRIKE') {
        result += `~~${serializeVisualInlineNodes(node)}~~`;
        return;
      }
      if (node.tagName === 'STRONG' || node.tagName === 'B') {
        result += `**${serializeVisualInlineNodes(node)}**`;
        return;
      }
      if (node.tagName === 'EM' || node.tagName === 'I') {
        result += `*${serializeVisualInlineNodes(node)}*`;
        return;
      }
      if (node.tagName === 'CODE' || cl.contains('md-inline-code')) {
        result += `\`${serializeVisualInlineNodes(node)}\``;
        return;
      }
      result += serializeVisualInlineNodes(node);
    }
  });
  return result;
}

function serializeVisualBlockElement(el) {
  const cl = el.classList;
  if (cl.contains('md-code-block') || el.dataset.codeBlock === 'true') {
    const codeText = stripZws(el.innerText || el.textContent).replace(/\u00a0/g, ' ');
    return `\`\`\`\n${codeText}\n\`\`\``;
  }
  if (cl.contains('md-visual-hr')) {
    return '---';
  }
  if (cl.contains('md-task-item')) {
    const isChecked = !!el.querySelector('input[type="checkbox"]')?.checked;
    const indent = parseInt(el.dataset.indent || '0', 10) || 0;
    const prefix = '\t'.repeat(Math.max(0, indent));
    const text = serializeVisualInlineNodes(el).trim();
    return `${prefix}- [${isChecked ? 'x' : ' '}] ${text}`;
  }
  if (cl.contains('md-list-item')) {
    const indent = parseInt(el.dataset.indent || '0', 10) || 0;
    const prefix = '\t'.repeat(Math.max(0, indent));
    const text = serializeVisualInlineNodes(el).trim();
    return `${prefix}- ${text}`;
  }
  if (cl.contains('md-callout')) {
    const type = el.dataset.calloutType || 'info';
    const text = serializeVisualInlineNodes(el).trim();
    return `> [!${type}] ${text}`;
  }
  if (cl.contains('md-blockquote')) {
    const text = serializeVisualInlineNodes(el).trim();
    return `> ${text}`;
  }
  if (cl.contains('md-visual-heading')) {
    const level = parseInt(el.dataset.headingLevel || '1', 10);
    const text = serializeVisualInlineNodes(el).trim();
    return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`;
  }
  return serializeVisualInlineNodes(el);
}

// Converte toda a árvore do editor visual de volta para Markdown limpo sem perder texto
function visualEditorToMarkdown(visualContainer) {
  if (!visualContainer) return '';

  const lines = [];
  let looseBuffer = null;

  const flushLooseBuffer = () => {
    if (looseBuffer) {
      lines.push(serializeVisualInlineNodes(looseBuffer));
      looseBuffer = null;
    }
  };

  visualContainer.childNodes.forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE && ['DIV', 'P', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL'].includes(node.tagName)) {
      flushLooseBuffer();
      if (node.tagName === 'UL' || node.tagName === 'OL') {
        Array.from(node.children).forEach(li => {
          lines.push(`- ${serializeVisualInlineNodes(li).trim()}`);
        });
      } else {
        lines.push(serializeVisualBlockElement(node));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
      flushLooseBuffer();
    } else {
      if (!looseBuffer) looseBuffer = document.createDocumentFragment();
      looseBuffer.appendChild(node.cloneNode(true));
    }
  });
  flushLooseBuffer();

  return lines.join('\n').replace(/\n+$/g, (m) => (m.length > 1 ? '\n' : '')).trimEnd();
}

// Helpers para manipular seleção/cursor no modo visual
function setCaretAt(node, offset) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  savedVisualRange = range.cloneRange();
}

function setCaretInsideElementEnd(el) {
  const sel = window.getSelection();
  if (!sel || !el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  savedVisualRange = range.cloneRange();
}

function ensureCurrentVisualLine(visual, range) {
  const startNode = range.startContainer;
  const el = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode;
  const existingLine = el && el !== visual ? el.closest('.visual-line') : null;
  if (existingLine && visual.contains(existingLine)) {
    return existingLine;
  }

  // Se visual está vazio, cria primeira .visual-line
  if (!visual.firstChild || (visual.childNodes.length === 1 && visual.firstChild.tagName === 'BR')) {
    visual.innerHTML = '';
    const line = document.createElement('div');
    line.className = 'visual-line';
    line.innerHTML = '<br>';
    visual.appendChild(line);
    setCaretAt(line, 0);
    return line;
  }

  // Envolve nós soltos da raiz em .visual-line mantendo o cursor
  const targetChild = startNode === visual ? (visual.childNodes[range.startOffset] || visual.lastChild) : startNode;
  if (targetChild && targetChild.parentElement === visual) {
    if (targetChild.nodeType === Node.ELEMENT_NODE && targetChild.classList.contains('visual-line')) {
      return targetChild;
    }
    const line = document.createElement('div');
    line.className = 'visual-line';
    const isSelInsideTarget = startNode === targetChild && range.endContainer === targetChild;
    const startOff = range.startOffset;
    const endOff = range.endOffset;
    visual.insertBefore(line, targetChild);
    line.appendChild(targetChild);
    if (targetChild.nodeType === Node.TEXT_NODE) {
      if (isSelInsideTarget && startOff !== endOff) {
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(targetChild, Math.min(startOff, targetChild.textContent.length));
        r.setEnd(targetChild, Math.min(endOff, targetChild.textContent.length));
        sel.removeAllRanges();
        sel.addRange(r);
      } else {
        setCaretAt(targetChild, Math.min(startOff, targetChild.textContent.length));
      }
    } else {
      setCaretInsideElementEnd(line);
    }
    return line;
  }

  const line = document.createElement('div');
  line.className = 'visual-line';
  line.innerHTML = '<br>';
  visual.appendChild(line);
  setCaretAt(line, 0);
  return line;
}

// Auto-conversão de sintaxes inline ao fechar delimitadores no modo Visual
function tryAutoConvertInlineAtCaret(visual, textarea) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const textNode = range.startContainer;
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

  const parent = textNode.parentElement;
  if (!parent || parent.closest('code, .md-code-block, .md-tag, .md-wikilink, .md-link-inline')) return;

  const fullText = textNode.textContent;
  const cursorOffset = range.startOffset;
  const beforeCursor = fullText.substring(0, cursorOffset);

  const inlineRules = [
    {
      regex: /\*\*([^*\n\u200B]+)\*\*$/,
      createNode: (m) => { const el = document.createElement('strong'); el.textContent = m[1]; return el; }
    },
    {
      regex: /(?:^|[^*])(\*([^*\n\u200B]+)\*)$/,
      groupIndex: 1,
      createNode: (m) => { const el = document.createElement('em'); el.textContent = m[2]; return el; }
    },
    {
      regex: /==([^=\n\u200B]+)==$/,
      createNode: (m) => { const el = document.createElement('mark'); el.className = 'md-highlight'; el.textContent = m[1]; return el; }
    },
    {
      regex: /~~([^~\n\u200B]+)~~$/,
      createNode: (m) => { const el = document.createElement('del'); el.className = 'md-strikethrough'; el.textContent = m[1]; return el; }
    },
    {
      regex: /`([^`\n\u200B]+)`$/,
      createNode: (m) => { const el = document.createElement('code'); el.className = 'md-inline-code'; el.textContent = m[1]; return el; }
    },
    {
      regex: /\[\[([^\]\n\u200B]+)\]\]$/,
      createNode: (m) => {
        const el = document.createElement('span');
        el.className = 'md-wikilink';
        el.dataset.wikilink = '1';
        el.innerHTML = `<span class="vl-wikilink-icon" contenteditable="false">📄 </span><span class="vl-wikilink-text">${escapeHtml(m[1])}</span>`;
        return el;
      }
    },
    {
      regex: /\[([^\]\n]+)\]\(([^)\n]+)\)$/,
      createNode: (m) => {
        const el = document.createElement('span');
        el.className = 'md-link-inline';
        el.innerHTML = `<span class="md-link-bracket" contenteditable="false">[</span><span class="md-link-text">${escapeHtml(m[1])}</span><span class="md-link-bracket" contenteditable="false">](</span><span class="md-link-url">${escapeHtml(m[2])}</span><span class="md-link-bracket" contenteditable="false">)</span>`;
        return el;
      }
    }
  ];

  for (const rule of inlineRules) {
    const match = beforeCursor.match(rule.regex);
    if (match) {
      const matchedStr = rule.groupIndex ? match[rule.groupIndex] : match[0];
      const matchStart = cursorOffset - matchedStr.length;

      const beforePart = fullText.substring(0, matchStart);
      const afterPart = fullText.substring(cursorOffset);
      const formattedEl = rule.createNode(match);

      const parentNode = textNode.parentNode;
      textNode.textContent = beforePart;

      const afterNode = document.createTextNode(afterPart || '\u200B');
      parentNode.insertBefore(formattedEl, textNode.nextSibling);
      parentNode.insertBefore(afterNode, formattedEl.nextSibling);

      if (!beforePart) {
        parentNode.removeChild(textNode);
      }

      setCaretAt(afterNode, afterPart ? 0 : 1);
      textarea.value = visualEditorToMarkdown(visual);
      return;
    }
  }
}

// Converte #tag quando seguida de espaço/Enter
function tryConvertHashtagBeforeSpace(textNode, cursorOffset, visual, textarea, trailingChar = ' ') {
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
  const parent = textNode.parentElement;
  if (!parent || parent.closest('code, .md-code-block, .md-tag, .md-wikilink, .md-link-inline')) return false;

  const fullText = textNode.textContent;
  const before = fullText.substring(0, cursorOffset);
  const tagMatch = before.match(/(^|\s)(#[a-zA-Z0-9_\-\/]+)$/);
  if (!tagMatch) return false;

  const tagStr = tagMatch[2];
  const matchStart = cursorOffset - tagStr.length;
  const beforePart = fullText.substring(0, matchStart);
  const afterPart = fullText.substring(cursorOffset);

  const tagSpan = document.createElement('span');
  tagSpan.className = 'md-tag';
  tagSpan.textContent = tagStr;

  const parentNode = textNode.parentNode;
  textNode.textContent = beforePart;
  const spaceAfter = document.createTextNode(trailingChar + afterPart);

  parentNode.insertBefore(tagSpan, textNode.nextSibling);
  parentNode.insertBefore(spaceAfter, tagSpan.nextSibling);
  if (!beforePart) parentNode.removeChild(textNode);

  setCaretAt(spaceAfter, trailingChar.length);
  textarea.value = visualEditorToMarkdown(visual);
  return true;
}

// Escuta digitação, atalhos ao vivo, Enter e Backspace no bloco visual
function setupVisualEditorLiveKeys() {
  const visual = document.getElementById('card-content-visual');
  const textarea = document.getElementById('card-content-input');
  if (!visual || !textarea) return;

  // Rastreia continuamente a seleção do visual e da textarea
  const trackSelection = () => {
    if (document.getElementById('card-modal')?.style.display === 'flex') {
      saveEditorSelection();
    }
  };
  visual.addEventListener('keyup', trackSelection);
  visual.addEventListener('mouseup', trackSelection);
  textarea.addEventListener('keyup', trackSelection);
  textarea.addEventListener('mouseup', trackSelection);
  textarea.addEventListener('select', trackSelection);

  // Alterna checkbox diretamente no modo visual
  visual.addEventListener('change', (e) => {
    if (e.target.classList.contains('md-task-checkbox')) {
      const taskLine = e.target.closest('.md-task-item');
      if (taskLine) {
        taskLine.classList.toggle('completed', e.target.checked);
      }
      textarea.value = visualEditorToMarkdown(visual);
    }
  });

  // Suporte completo a Tab / Shift+Tab no modo Texto Puro (igual ao Obsidian)
  textarea.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();

    const value = textarea.value;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const rawLineEnd = value.indexOf('\n', end);
    const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;
    const selectedSlice = value.substring(start, end);
    const isMultiLine = selectedSlice.includes('\n');
    const currentLine = value.substring(lineStart, lineEnd);
    const isListOrTaskLine = /^[\t ]*(?:[-*+]\s+(?:\[[ xX]\]\s+)?)/.test(currentLine);

    if (e.shiftKey || isMultiLine || isListOrTaskLine) {
      const block = value.substring(lineStart, lineEnd);
      const lines = block.split('\n');
      let firstLineDelta = 0;
      let totalDelta = 0;

      const updated = lines.map((line, idx) => {
        if (e.shiftKey) {
          const match = line.match(/^(\t| {1,4})/);
          if (match) {
            const removed = match[1].length;
            if (idx === 0) firstLineDelta = -removed;
            totalDelta -= removed;
            return line.substring(removed);
          }
          return line;
        } else {
          if (idx === 0) firstLineDelta = 1;
          totalDelta += 1;
          return '\t' + line;
        }
      }).join('\n');

      textarea.value = value.substring(0, lineStart) + updated + value.substring(lineEnd);
      textarea.selectionStart = Math.max(lineStart, start + firstLineDelta);
      textarea.selectionEnd = Math.max(textarea.selectionStart, end + totalDelta);
    } else {
      textarea.value = value.substring(0, start) + '\t' + value.substring(end);
      textarea.selectionStart = start + 1;
      textarea.selectionEnd = start + 1;
    }
    saveEditorSelection();
  });

  visual.addEventListener('keydown', (e) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    // 0. Tab / Shift+Tab no modo Visual: indentação real sem perder foco do editor
    if (e.key === 'Tab') {
      e.preventDefault();
      const currentLineEl = ensureCurrentVisualLine(visual, range);
      const linesInRange = Array.from(visual.querySelectorAll('.visual-line')).filter(l => range.intersectsNode(l));
      const targetLines = linesInRange.length > 0 ? linesInRange : [currentLineEl];
      const isListLine = (el) => el && (el.classList.contains('md-task-item') || el.classList.contains('md-list-item'));

      // Se alguma linha alvo é lista/checklist ou há seleção múltipla ou Shift+Tab
      if (e.shiftKey || targetLines.length > 1 || isListLine(currentLineEl)) {
        targetLines.forEach(lineEl => {
          if (isListLine(lineEl)) {
            const cur = parseInt(lineEl.dataset.indent || '0', 10) || 0;
            setVisualLineIndent(lineEl, e.shiftKey ? cur - 1 : cur + 1);
          } else if (e.shiftKey) {
            // Remove tab/espaços do início da linha normal
            const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT, null);
            const firstText = walker.nextNode();
            if (firstText) {
              const m = firstText.textContent.match(/^(\t| {1,4})/);
              if (m) {
                firstText.textContent = firstText.textContent.substring(m[1].length);
              }
            }
          } else {
            const tabNode = document.createTextNode('\t');
            lineEl.insertBefore(tabNode, lineEl.firstChild);
          }
        });
        textarea.value = visualEditorToMarkdown(visual);
        saveEditorSelection();
        return;
      }

      // Linha normal no modo visual: insere \t na posição do cursor
      range.deleteContents();
      const tabNode = document.createTextNode('\t');
      range.insertNode(tabNode);
      setCaretAt(tabNode, 1);
      textarea.value = visualEditorToMarkdown(visual);
      return;
    }

    // 1. Espaço: converte prefixos de linha e #tags ou sai de tags fechadas
    if (e.key === ' ') {
      const textNode = range.startContainer;
      const lineEl = (textNode.nodeType === Node.TEXT_NODE ? textNode.parentElement : textNode)?.closest('.visual-line');

      // Sair de .md-tag ou .md-wikilink ao pressionar espaço no final
      const activePill = (textNode.nodeType === Node.TEXT_NODE ? textNode.parentElement : textNode)?.closest('.md-tag, .md-wikilink');
      if (activePill && textNode.nodeType === Node.TEXT_NODE) {
        e.preventDefault();
        const spaceNode = document.createTextNode(' ');
        activePill.after(spaceNode);
        setCaretAt(spaceNode, 1);
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      if (textNode.nodeType === Node.TEXT_NODE && !textNode.parentElement?.closest('code, .md-code-block')) {
        const rawBeforeCursor = (() => {
          if (!lineEl) return stripZws(textNode.textContent.substring(0, range.startOffset));
          const rLine = document.createRange();
          rLine.selectNodeContents(lineEl.querySelector('.visual-line-text') || lineEl);
          rLine.setEnd(textNode, range.startOffset);
          return stripZws(rLine.toString());
        })();
        const beforeCursor = rawBeforeCursor.trimStart();
        const leadingIndent = getLineIndentLevel(rawBeforeCursor);
        const isAtLineStart = rawBeforeCursor.length > 0 && /^[\t ]*(?:-\s*\[[ xX]\]|[-*]|#{1,6}|>\s*\[![a-zA-Z0-9_-]+\]|>|\[[ xX]\])$/.test(rawBeforeCursor);

        // Upgrade de lista (•) para checklist se digitar [ ] ou [x]
        if (lineEl && lineEl.classList.contains('md-list-item') && /^\[([ xX])\]$/.test(beforeCursor)) {
          e.preventDefault();
          const isChecked = beforeCursor.toLowerCase().includes('x');
          const curIndent = parseInt(lineEl.dataset.indent || '0', 10) || 0;
          const taskDiv = document.createElement('div');
          taskDiv.className = `visual-line md-task-item ${isChecked ? 'completed' : ''}`;
          taskDiv.innerHTML = `<span class="visual-check-wrap" contenteditable="false"><input type="checkbox" class="md-task-checkbox" ${isChecked ? 'checked' : ''} /></span><span class="visual-line-text">\u200B</span>`;
          setVisualLineIndent(taskDiv, curIndent);
          lineEl.replaceWith(taskDiv);
          setCaretInsideElementEnd(taskDiv.querySelector('.visual-line-text'));
          textarea.value = visualEditorToMarkdown(visual);
          return;
        }

        // Prefixos no início de linha limpa
        const isPlainLine = !lineEl || (!lineEl.classList.contains('md-task-item') && !lineEl.classList.contains('md-list-item') && !lineEl.classList.contains('md-callout') && !lineEl.classList.contains('md-blockquote') && !lineEl.classList.contains('md-visual-heading'));
        if (isPlainLine && isAtLineStart) {
          // Checklist direto: - [ ] ou - [x] (inclusive após tabs)
          const taskMatch = beforeCursor.match(/^-\s*\[([ xX])\]$/);
          if (taskMatch) {
            e.preventDefault();
            const isChecked = taskMatch[1].toLowerCase() === 'x';
            const targetLine = ensureCurrentVisualLine(visual, range);
            const taskDiv = document.createElement('div');
            taskDiv.className = `visual-line md-task-item ${isChecked ? 'completed' : ''}`;
            taskDiv.innerHTML = `<span class="visual-check-wrap" contenteditable="false"><input type="checkbox" class="md-task-checkbox" ${isChecked ? 'checked' : ''} /></span><span class="visual-line-text">\u200B</span>`;
            setVisualLineIndent(taskDiv, leadingIndent);
            targetLine.replaceWith(taskDiv);
            setCaretInsideElementEnd(taskDiv.querySelector('.visual-line-text'));
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }

          // Lista com marcador: - ou * (inclusive após tabs)
          if (/^[-*]$/.test(beforeCursor)) {
            e.preventDefault();
            const targetLine = ensureCurrentVisualLine(visual, range);
            const listDiv = document.createElement('div');
            listDiv.className = 'visual-line md-list-item';
            listDiv.innerHTML = `<span class="visual-bullet" contenteditable="false">• </span><span class="visual-line-text">\u200B</span>`;
            setVisualLineIndent(listDiv, leadingIndent);
            targetLine.replaceWith(listDiv);
            setCaretInsideElementEnd(listDiv.querySelector('.visual-line-text'));
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }

          // Cabeçalho: # a ######
          const headMatch = beforeCursor.match(/^(#{1,6})$/);
          if (headMatch) {
            e.preventDefault();
            const level = headMatch[1].length;
            const targetLine = ensureCurrentVisualLine(visual, range);
            const hDiv = document.createElement('div');
            hDiv.className = `visual-line md-visual-heading md-h${level}`;
            hDiv.dataset.headingLevel = String(level);
            hDiv.textContent = '\u200B';
            targetLine.replaceWith(hDiv);
            setCaretInsideElementEnd(hDiv);
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }

          // Callout: > [!tipo]
          const calloutMatch = beforeCursor.match(/^>\s*\[!([a-zA-Z0-9_-]+)\]$/);
          if (calloutMatch) {
            e.preventDefault();
            const type = calloutMatch[1].toLowerCase();
            const targetLine = ensureCurrentVisualLine(visual, range);
            const cDiv = document.createElement('div');
            cDiv.className = `visual-line md-callout callout-${escapeHtml(type)}`;
            cDiv.dataset.calloutType = type;
            cDiv.innerHTML = `<span class="visual-callout-badge" contenteditable="false">💡 [${escapeHtml(type)}] </span><span class="visual-line-text">\u200B</span>`;
            targetLine.replaceWith(cDiv);
            setCaretInsideElementEnd(cDiv.querySelector('.visual-line-text'));
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }

          // Blockquote: >
          if (beforeCursor === '>') {
            e.preventDefault();
            const targetLine = ensureCurrentVisualLine(visual, range);
            const qDiv = document.createElement('div');
            qDiv.className = 'visual-line md-blockquote';
            qDiv.innerHTML = `<span class="visual-line-text">\u200B</span>`;
            targetLine.replaceWith(qDiv);
            setCaretInsideElementEnd(qDiv.querySelector('.visual-line-text'));
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }
        }

        // Tag inline (#palavra) seguida de espaço
        if (tryConvertHashtagBeforeSpace(textNode, range.startOffset, visual, textarea, ' ')) {
          e.preventDefault();
          return;
        }
      }
    }

    // 2. Tecla Enter: blocos, continuação de listas e linha horizontal
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
      const startNode = range.startContainer;
      const lineEl = (startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode)?.closest('.visual-line');

      // Dentro de bloco de código: Shift+Enter ou Esc sai; Enter normal insere quebra dentro
      if (lineEl && lineEl.classList.contains('md-code-block')) {
        e.preventDefault();
        if (e.shiftKey) {
          const newLine = document.createElement('div');
          newLine.className = 'visual-line';
          newLine.innerHTML = '<br>';
          lineEl.after(newLine);
          setCaretAt(newLine, 0);
        } else {
          const nl = document.createTextNode('\n');
          range.deleteContents();
          range.insertNode(nl);
          setCaretAt(nl, 1);
        }
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      // Continua ou encerra checklist / lista / blockquote (preservando indentação)
      if (lineEl && (lineEl.classList.contains('md-task-item') || lineEl.classList.contains('md-list-item') || lineEl.classList.contains('md-blockquote'))) {
        e.preventDefault();
        const text = stripZws((lineEl.querySelector('.visual-line-text') || lineEl).textContent).replace(/\u00a0/g, '').trim();
        const curIndent = parseInt(lineEl.dataset.indent || '0', 10) || 0;

        if (!text) {
          if (curIndent > 0 && (lineEl.classList.contains('md-task-item') || lineEl.classList.contains('md-list-item'))) {
            setVisualLineIndent(lineEl, curIndent - 1);
            textarea.value = visualEditorToMarkdown(visual);
            return;
          }
          const plain = document.createElement('div');
          plain.className = 'visual-line';
          plain.innerHTML = '<br>';
          lineEl.replaceWith(plain);
          setCaretAt(plain, 0);
          textarea.value = visualEditorToMarkdown(visual);
          return;
        }

        const nextLine = document.createElement('div');
        if (lineEl.classList.contains('md-task-item')) {
          nextLine.className = 'visual-line md-task-item';
          nextLine.innerHTML = `<span class="visual-check-wrap" contenteditable="false"><input type="checkbox" class="md-task-checkbox" /></span><span class="visual-line-text">\u200B</span>`;
          setVisualLineIndent(nextLine, curIndent);
        } else if (lineEl.classList.contains('md-list-item')) {
          nextLine.className = 'visual-line md-list-item';
          nextLine.innerHTML = `<span class="visual-bullet" contenteditable="false">• </span><span class="visual-line-text">\u200B</span>`;
          setVisualLineIndent(nextLine, curIndent);
        } else {
          nextLine.className = 'visual-line md-blockquote';
          nextLine.innerHTML = `<span class="visual-line-text">\u200B</span>`;
        }
        lineEl.after(nextLine);
        setCaretInsideElementEnd(nextLine.querySelector('.visual-line-text'));
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      // Linha normal: verifica --- / *** (HR), ``` (Bloco de código), - [ ] ou #tag antes de pular linha
      const currentPlain = lineEl ? stripZws(lineEl.textContent).trim() : stripZws(startNode.textContent || '').trim();
      if (/^(\*{3,}|-{3,})$/.test(currentPlain)) {
        e.preventDefault();
        const target = ensureCurrentVisualLine(visual, range);
        const hrDiv = document.createElement('div');
        hrDiv.className = 'visual-line md-visual-hr';
        hrDiv.setAttribute('contenteditable', 'false');
        hrDiv.innerHTML = '<hr class="md-hr" />';
        const nextLine = document.createElement('div');
        nextLine.className = 'visual-line';
        nextLine.innerHTML = '<br>';
        target.replaceWith(hrDiv);
        hrDiv.after(nextLine);
        setCaretAt(nextLine, 0);
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      if (/^```/.test(currentPlain)) {
        e.preventDefault();
        const target = ensureCurrentVisualLine(visual, range);
        const codeDiv = document.createElement('div');
        codeDiv.className = 'visual-line md-code-block';
        codeDiv.dataset.codeBlock = 'true';
        codeDiv.textContent = '\u200B';
        target.replaceWith(codeDiv);
        setCaretInsideElementEnd(codeDiv);
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      // Converte #tag no fim da linha antes do Enter
      if (startNode.nodeType === Node.TEXT_NODE) {
        tryConvertHashtagBeforeSpace(startNode, range.startOffset, visual, textarea, '');
      }

      // Evita que o browser herde heading/callout/strong/mark na linha de baixo
      e.preventDefault();
      const target = ensureCurrentVisualLine(visual, sel.getRangeAt(0));
      const nextLine = document.createElement('div');
      nextLine.className = 'visual-line';
      nextLine.innerHTML = '<br>';
      target.after(nextLine);
      setCaretAt(nextLine, 0);
      textarea.value = visualEditorToMarkdown(visual);
      return;
    }

    // 3. Backspace inteligente: remove tags de bloco e tags inline vazias
    if (e.key === 'Backspace' && range.collapsed) {
      const startNode = range.startContainer;
      const el = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode;
      const lineEl = el?.closest('.visual-line');

      // Verifica se está no início efetivo do conteúdo da linha (ignorando \u200B)
      const isAtStartOfLineText = (() => {
        if (!lineEl) return false;
        const textContainer = lineEl.querySelector('.visual-line-text') || lineEl;
        if (startNode === textContainer && range.startOffset === 0) return true;
        if (startNode.nodeType === Node.TEXT_NODE) {
          const beforeText = stripZws(startNode.textContent.substring(0, range.startOffset));
          if (beforeText.length > 0) return false;
          // Confirma que não há nós com texto antes deste nó dentro do textContainer
          let prev = startNode.previousSibling;
          while (prev) {
            if (stripZws(prev.textContent).length > 0 && !prev.classList?.contains('visual-check-wrap') && !prev.classList?.contains('visual-bullet') && !prev.classList?.contains('visual-callout-badge')) {
              return false;
            }
            prev = prev.previousSibling;
          }
          return true;
        }
        return false;
      })();

      // 3a. Recua indentação (se indent > 0) ou remove tag de bloco mantendo o conteúdo da linha
      if (lineEl && isAtStartOfLineText && (
        lineEl.classList.contains('md-task-item') ||
        lineEl.classList.contains('md-list-item') ||
        lineEl.classList.contains('md-blockquote') ||
        lineEl.classList.contains('md-callout') ||
        lineEl.classList.contains('md-visual-heading') ||
        lineEl.classList.contains('md-code-block')
      )) {
        e.preventDefault();
        const curIndent = parseInt(lineEl.dataset.indent || '0', 10) || 0;
        if (curIndent > 0 && (lineEl.classList.contains('md-task-item') || lineEl.classList.contains('md-list-item'))) {
          setVisualLineIndent(lineEl, curIndent - 1);
          textarea.value = visualEditorToMarkdown(visual);
          return;
        }

        const textContainer = lineEl.querySelector('.visual-line-text') || lineEl;
        const plain = document.createElement('div');
        plain.className = 'visual-line';
        const preserved = [];
        textContainer.childNodes.forEach(n => {
          if (n.nodeType === Node.ELEMENT_NODE && (n.classList.contains('visual-check-wrap') || n.classList.contains('visual-bullet') || n.classList.contains('visual-callout-badge'))) {
            return;
          }
          preserved.push(n.cloneNode(true));
        });
        preserved.forEach(n => plain.appendChild(n));
        if (!stripZws(plain.textContent)) plain.innerHTML = '<br>';
        lineEl.replaceWith(plain);
        if (plain.firstChild && plain.firstChild.nodeType === Node.TEXT_NODE) {
          setCaretAt(plain.firstChild, 0);
        } else {
          setCaretAt(plain, 0);
        }
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      // 3b. Remove <hr> anterior se der backspace no início de uma linha vazia logo após ele
      if (lineEl && isAtStartOfLineText && lineEl.previousElementSibling?.classList.contains('md-visual-hr')) {
        e.preventDefault();
        lineEl.previousElementSibling.remove();
        textarea.value = visualEditorToMarkdown(visual);
        return;
      }

      // 3c. Remove tag inline quando ficar vazia ou só com marcador (# / \u200B)
      const inlineTag = el?.closest('strong, b, em, i, mark, del, s, code, .md-tag, .md-wikilink, .md-link-inline');
      if (inlineTag && visual.contains(inlineTag)) {
        const cleanVisible = stripZws(
          inlineTag.classList.contains('md-wikilink')
            ? (inlineTag.querySelector('.vl-wikilink-text')?.textContent || '')
            : inlineTag.textContent
        );
        const isOnlyHash = inlineTag.classList.contains('md-tag') && cleanVisible === '#';
        if (cleanVisible.length === 0 || isOnlyHash || (cleanVisible.length === 1 && !inlineTag.classList.contains('md-tag') && range.startOffset <= (startNode.textContent.startsWith('\u200B') ? 2 : 1))) {
          e.preventDefault();
          const placeholder = document.createTextNode('\u200B');
          inlineTag.replaceWith(placeholder);
          setCaretAt(placeholder, 1);
          textarea.value = visualEditorToMarkdown(visual);
          return;
        }
      }

      // 3d. Se o nó anterior ou atual antes do cursor é apenas \u200B, pula \u200B para o Backspace apagar de verdade
      if (startNode.nodeType === Node.TEXT_NODE && range.startOffset === 1 && startNode.textContent === '\u200B') {
        startNode.textContent = '';
      }
    }
  });

  // Atualiza tokens inline e sincroniza com o textarea em toda digitação
  visual.addEventListener('input', () => {
    tryAutoConvertInlineAtCaret(visual, textarea);

    // Limpa tags inline que ficaram completamente vazias após edição
    visual.querySelectorAll('strong, em, mark, del, code, .md-tag, .md-wikilink').forEach(el => {
      const txt = stripZws(el.classList.contains('md-wikilink') ? (el.querySelector('.vl-wikilink-text')?.textContent || '') : el.textContent);
      if (!txt) {
        el.remove();
      }
    });

    const md = visualEditorToMarkdown(visual);
    textarea.value = md;
    if (!md && visual.innerHTML !== '') {
      // Se só restaram <br>/divs vazios após apagar tudo, exibe o placeholder
      if (!visual.querySelector('.md-task-item, .md-list-item, .md-blockquote, .md-callout, .md-visual-heading, .md-visual-hr, .md-code-block')) {
        visual.innerHTML = '';
      }
    }
    saveEditorSelection();
  });
}

// Modal de Criação / Edição de Card
let targetColForNewCard = null;

window.openNewCardModal = function (colId) {
  editingCardId = null;
  targetColForNewCard = colId;
  savedVisualRange = null;
  savedRawSelection = null;
  renderAssigneesSelection([]);
  document.getElementById('card-modal-title').textContent = 'Novo Item';
  document.getElementById('save-card-btn').textContent = 'Adicionar Item';
  document.getElementById('card-content-input').value = '';
  document.getElementById('card-urgency-select').value = '';
  document.getElementById('card-date-input').value = '';

  const visual = document.getElementById('card-content-visual');
  if (visual) visual.innerHTML = '';

  switchEditorMode(currentEditorMode);

  document.getElementById('card-modal').style.display = 'flex';
  if (currentEditorMode === 'live' && visual) {
    visual.focus();
  } else {
    document.getElementById('card-content-input').focus();
  }
};

window.openEditCardModal = function (colId, cardId) {
  editingCardId = cardId;
  targetColForNewCard = colId;
  savedVisualRange = null;
  savedRawSelection = null;
  const col = currentProject.columns.find(c => c.id === colId);
  if (!col) return;
  const card = col.cards.find(c => c.id === cardId);
  if (!card) return;

  const currentAssignees = Array.isArray(card.assignees)
    ? card.assignees
    : (card.assignee ? [card.assignee] : []);

  renderAssigneesSelection(currentAssignees);
  document.getElementById('card-modal-title').textContent = 'Editar Item';
  document.getElementById('save-card-btn').textContent = 'Salvar Alterações';
  document.getElementById('card-content-input').value = card.content || '';
  document.getElementById('card-urgency-select').value = card.urgency || '';
  document.getElementById('card-date-input').value = card.dueDate || '';

  const visual = document.getElementById('card-content-visual');
  if (visual) visual.innerHTML = renderVisualEditorHtml(card.content || '');

  switchEditorMode(currentEditorMode);

  document.getElementById('card-modal').style.display = 'flex';
  if (currentEditorMode === 'live' && visual) {
    visual.focus();
  } else {
    document.getElementById('card-content-input').focus();
  }
};

window.deleteCard = async function (colId, cardId, event) {
  if (event) event.stopPropagation();
  const confirmed = await showConfirmModal('Deseja realmente excluir este item?', 'Excluir Item');
  if (!confirmed) return;

  const col = currentProject.columns.find(c => c.id === colId);
  if (col) {
    col.cards = col.cards.filter(c => c.id !== cardId);
    await syncProject();
    renderBoard();
  }
};

window.closeCardModal = function () {
  document.getElementById('card-modal').style.display = 'none';
  editingCardId = null;
};

window.saveCardAction = async function () {
  const visual = document.getElementById('card-content-visual');
  const textarea = document.getElementById('card-content-input');

  // Sincroniza estado antes de salvar se estiver no modo visual
  if (currentEditorMode === 'live' && visual && textarea) {
    textarea.value = visualEditorToMarkdown(visual);
  }

  const content = textarea.value.trim();
  const urgency = document.getElementById('card-urgency-select').value || null;
  const assignees = getSelectedAssignees();
  const dueDate = document.getElementById('card-date-input').value || null;

  if (!content) return;

  // Se não foi informada coluna alvo específica, usa a primeira disponível
  if (!targetColForNewCard && currentProject && currentProject.columns.length > 0) {
    targetColForNewCard = currentProject.columns[0].id;
  }

  const col = currentProject.columns.find(c => c.id === targetColForNewCard);
  if (!col) return;

  if (editingCardId) {
    // Modo Edição
    const card = col.cards.find(c => c.id === editingCardId);
    if (card) {
      card.content = content;
      card.urgency = urgency;
      card.assignees = assignees;
      delete card.assignee;
      card.dueDate = dueDate;
    }
  } else {
    // Modo Criação
    col.cards.push({
      id: 'card_' + Math.random().toString(36).substring(2, 9),
      content,
      urgency,
      assignees,
      dueDate,
      completed: false
    });
  }

  await syncProject();
  renderBoard();
  closeCardModal();
};

// Visualizador de Imagens (Lightbox)
window.openLightbox = function (imageSrc) {
  const lightbox = document.getElementById('image-lightbox');
  const targetImg = document.getElementById('lightbox-target-img');
  targetImg.src = imageSrc;
  lightbox.style.display = 'flex';
};

window.closeLightbox = function (event) {
  if (event.target.id === 'image-lightbox' || event.target.classList.contains('lightbox-close-btn')) {
    document.getElementById('image-lightbox').style.display = 'none';
    document.getElementById('lightbox-target-img').src = '';
  }
};

// Fecha lightbox no ESC (respeitando modais superiores abertos)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const lightbox = document.getElementById('image-lightbox');
    if (lightbox && lightbox.style.display === 'flex') {
      lightbox.style.display = 'none';
      document.getElementById('lightbox-target-img').src = '';
      return;
    }
    const hotkeysModal = document.getElementById('hotkeys-settings-modal');
    if (hotkeysModal && hotkeysModal.style.display === 'flex') {
      closeHotkeysSettingsModal();
      return;
    }
    const paletteModal = document.getElementById('command-palette-modal');
    if (paletteModal && paletteModal.style.display === 'flex') {
      return; // Tratado pelo listener da paleta
    }
    const cardModal = document.getElementById('card-modal');
    if (cardModal && cardModal.style.display === 'flex') {
      closeCardModal();
    }
  }
});

// Captura de Ctrl+V (Clipboard Paste) para Upload Automático de Imagens
function setupGlobalClipboardPaste() {
  window.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let imageItem = null;

    for (let item of items) {
      if (item.type.indexOf('image') === 0) {
        imageItem = item;
        break;
      }
    }

    if (!imageItem) return;

    const blob = imageItem.getAsFile();
    const formData = new FormData();
    formData.append('file', blob, 'clipboard_image.png');

    try {
      const res = await fetch('/api/attachments', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        // Se o modal de criação estiver aberto, adiciona no editor ativo
        const textarea = document.getElementById('card-content-input');
        const visual = document.getElementById('card-content-visual');
        if (document.getElementById('card-modal').style.display === 'flex' && textarea) {
          if (currentEditorMode === 'live' && visual) {
            textarea.value = visualEditorToMarkdown(visual);
          }
          textarea.value = (textarea.value ? textarea.value + '\n' : '') + data.markdown + '\n';
          if (currentEditorMode === 'live' && visual) {
            visual.innerHTML = renderVisualEditorHtml(textarea.value);
          }
        } else if (currentProject && currentProject.columns.length > 0) {
          // Cria direto um card na primeira coluna
          currentProject.columns[0].cards.push({
            id: 'card_' + Math.random().toString(36).substring(2, 9),
            content: `Imagem colada:\n${data.markdown}`,
            urgency: null,
            dueDate: null,
            completed: false
          });
          await syncProject();
          renderBoard();
        }
      }
    } catch (err) {
      console.error('Falha no upload do paste:', err);
    }
  });
}

// ==========================================
// Paleta de Comandos & Atalhos de Teclado Markdown
// ==========================================

const DEFAULT_COMMANDS = [
  {
    id: 'checklist',
    name: 'Checklist / Tarefa',
    desc: 'Insere uma caixa de seleção (- [ ])',
    icon: '☑️',
    keywords: 'check checklist tarefa todo afazer item lista',
    defaultHotkey: 'Alt+L',
    prefix: '- [ ] ',
    suffix: '',
    cursorOffset: 6
  },
  {
    id: 'bold',
    name: 'Negrito',
    desc: 'Destaca o texto com espessura grossa (**texto**)',
    icon: '𝐁',
    keywords: 'negrito bold forte escuro',
    defaultHotkey: 'Ctrl+B',
    prefix: '**',
    suffix: '**'
  },
  {
    id: 'italic',
    name: 'Itálico',
    desc: 'Inclina o texto (*texto*)',
    icon: '𝑖',
    keywords: 'italico italic enfase',
    defaultHotkey: 'Ctrl+I',
    prefix: '*',
    suffix: '*'
  },
  {
    id: 'highlight',
    name: 'Destaque (Marca-texto)',
    desc: 'Realça com fundo amarelo pastel (==texto==)',
    icon: '🖍️',
    keywords: 'destaque highlight marcar marcadortexto marca-texto cor',
    defaultHotkey: 'Alt+H',
    prefix: '==',
    suffix: '=='
  },
  {
    id: 'strikethrough',
    name: 'Tachado / Riscado',
    desc: 'Risca o texto no meio (~~texto~~)',
    icon: '⚡',
    keywords: 'tachado riscado strike cancelado deletado',
    defaultHotkey: 'Alt+X',
    prefix: '~~',
    suffix: '~~'
  },
  {
    id: 'wikilink',
    name: 'Link de Projeto (Wikilink)',
    desc: 'Cria navegação rápida para outro projeto ([[Nome]])',
    icon: '🔗',
    keywords: 'wikilink link projeto navegar pagina nota obsidian',
    defaultHotkey: 'Alt+W',
    prefix: '[[',
    suffix: ']]'
  },
  {
    id: 'tag',
    name: 'Tag / Etiqueta',
    desc: 'Etiqueta com filtro rápido visual (#tag)',
    icon: '🏷️',
    keywords: 'tag etiqueta categoria filtro hashtag',
    defaultHotkey: 'Alt+T',
    prefix: '#',
    suffix: ''
  },
  {
    id: 'link',
    name: 'Link Externo',
    desc: 'Insere hyperlink padrão ([texto](url))',
    icon: '🌐',
    keywords: 'link url website externo hyperlink',
    defaultHotkey: 'Ctrl+K',
    prefix: '[',
    suffix: '](https://)'
  },
  {
    id: 'code_inline',
    name: 'Código Inline',
    desc: 'Formata código em linha (`código`)',
    icon: '💻',
    keywords: 'codigo code inline comando script',
    defaultHotkey: 'Ctrl+Shift+C',
    prefix: '`',
    suffix: '`'
  },
  {
    id: 'code_block',
    name: 'Bloco de Código',
    desc: 'Bloco de código multilinha (```)',
    icon: '📦',
    keywords: 'bloco codigo block code syntax',
    defaultHotkey: 'Ctrl+Shift+B',
    prefix: '```\n',
    suffix: '\n```'
  },
  {
    id: 'callout_info',
    name: 'Callout de Informação',
    desc: 'Caixa de aviso pastel estilizada (> [!info])',
    icon: 'ℹ️',
    keywords: 'callout info aviso nota box informacao painel',
    defaultHotkey: 'Alt+I',
    prefix: '> [!info] ',
    suffix: ''
  },
  {
    id: 'callout_warning',
    name: 'Callout de Alerta / Atenção',
    desc: 'Caixa de alerta pastel (> [!warning])',
    icon: '⚠️',
    keywords: 'callout warning alerta perigo cuidado atencao',
    defaultHotkey: 'Alt+A',
    prefix: '> [!warning] ',
    suffix: ''
  },
  {
    id: 'quote',
    name: 'Citação em Bloco',
    desc: 'Citação identada (> texto)',
    icon: '❝',
    keywords: 'citacao quote bloco citar',
    defaultHotkey: 'Alt+Q',
    prefix: '> ',
    suffix: ''
  },
  {
    id: 'horizontal_rule',
    name: 'Linha Divisória',
    desc: 'Separador horizontal (---)',
    icon: '➖',
    keywords: 'linha divisoria separador horizontal hr rule',
    defaultHotkey: 'Alt+D',
    prefix: '---',
    suffix: ''
  }
];

function getStoredHotkeys() {
  try {
    const raw = localStorage.getItem('kanban_custom_hotkeys');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveCustomHotkey(cmdId, hotkeyString) {
  const current = getStoredHotkeys();
  if (hotkeyString) {
    current[cmdId] = hotkeyString;
  } else {
    delete current[cmdId];
  }
  localStorage.setItem('kanban_custom_hotkeys', JSON.stringify(current));
  renderHotkeysSettingsList();
  renderPaletteCommandsList();
}

function getCommandHotkey(cmd) {
  const custom = getStoredHotkeys();
  return custom[cmd.id] || cmd.defaultHotkey || '';
}

let paletteSelectedIndex = 0;
let filteredCommands = [...DEFAULT_COMMANDS];

export function openCommandPalette() {
  saveEditorSelection();
  const modal = document.getElementById('command-palette-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('palette-search-input');
  if (input) {
    input.value = '';
    input.focus();
  }
  paletteSelectedIndex = 0;
  filterPaletteCommands();
}

export function closeCommandPalette(skipFocus = false) {
  const modal = document.getElementById('command-palette-modal');
  if (modal) modal.style.display = 'none';
  if (skipFocus) return;

  const cardModal = document.getElementById('card-modal');
  const visual = document.getElementById('card-content-visual');
  const textarea = document.getElementById('card-content-input');
  if (cardModal && cardModal.style.display === 'flex') {
    if (currentEditorMode === 'live' && visual) {
      visual.focus();
    } else if (textarea) {
      textarea.focus();
    }
  }
}

window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;

window.handlePaletteBackdropClick = function (e) {
  if (e.target.id === 'command-palette-modal') {
    closeCommandPalette();
  }
};

window.filterPaletteCommands = function () {
  const input = document.getElementById('palette-search-input');
  const query = (input ? input.value : '').trim().toLowerCase();

  if (!query) {
    filteredCommands = [...DEFAULT_COMMANDS];
  } else {
    filteredCommands = DEFAULT_COMMANDS.filter(cmd => {
      const matchName = cmd.name.toLowerCase().includes(query);
      const matchDesc = cmd.desc.toLowerCase().includes(query);
      const matchKeys = cmd.keywords.toLowerCase().includes(query);
      const hotkey = getCommandHotkey(cmd).toLowerCase();
      const matchHotkey = hotkey.includes(query);
      return matchName || matchDesc || matchKeys || matchHotkey;
    });
  }

  paletteSelectedIndex = 0;
  renderPaletteCommandsList();
};

function renderPaletteCommandsList() {
  const container = document.getElementById('palette-commands-list');
  if (!container) return;

  if (filteredCommands.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
        Nenhum comando encontrado para esta busca.
      </div>
    `;
    return;
  }

  container.innerHTML = filteredCommands.map((cmd, idx) => {
    const isSelected = idx === paletteSelectedIndex;
    const hotkey = getCommandHotkey(cmd);
    const hotkeyHtml = hotkey ? `<span class="palette-shortcut-badge">${escapeHtml(hotkey)}</span>` : '';

    return `
      <div class="palette-item ${isSelected ? 'selected' : ''}" 
           data-cmd-id="${cmd.id}" 
           onclick="executePaletteCommand('${cmd.id}')"
           onmouseenter="setPaletteSelectedIndex(${idx})">
        <div class="palette-item-left">
          <span class="palette-item-icon">${cmd.icon}</span>
          <div>
            <div class="palette-item-title">${escapeHtml(cmd.name)}</div>
            <div class="palette-item-desc">${escapeHtml(cmd.desc)}</div>
          </div>
        </div>
        <div class="palette-item-right">
          ${hotkeyHtml}
        </div>
      </div>
    `;
  }).join('');

  const selectedEl = container.children[paletteSelectedIndex];
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

window.setPaletteSelectedIndex = function (idx) {
  paletteSelectedIndex = idx;
  const container = document.getElementById('palette-commands-list');
  if (!container) return;
  Array.from(container.children).forEach((child, i) => {
    if (i === idx) child.classList.add('selected');
    else child.classList.remove('selected');
  });
};

window.executePaletteCommand = function (cmdId) {
  const cmd = DEFAULT_COMMANDS.find(c => c.id === cmdId);
  if (!cmd) return;
  closeCommandPalette(true);
  applyCommandToEditor(cmd);
};

// Aplica comando respeitando o modo atual (Visual ou Texto Puro) e seleção
function applyCommandToEditor(cmd) {
  const cardModal = document.getElementById('card-modal');
  if (!cardModal || cardModal.style.display !== 'flex') {
    if (typeof window.openNewCardModal === 'function') {
      window.openNewCardModal();
    }
  }

  if (currentEditorMode === 'live') {
    applyCommandToVisual(cmd);
  } else {
    applyCommandToRaw(cmd);
  }
}

function applyCommandToRaw(cmd) {
  const textarea = document.getElementById('card-content-input');
  if (!textarea) return;

  textarea.focus();
  const selRange = savedRawSelection || { start: textarea.selectionStart || 0, end: textarea.selectionEnd || 0 };
  savedRawSelection = null;

  const start = selRange.start;
  const end = selRange.end;
  const value = textarea.value;
  const selectedText = value.substring(start, end);
  const prefix = cmd.prefix || '';
  const suffix = cmd.suffix || '';

  // Comandos de início de linha
  if (['checklist', 'quote', 'callout_info', 'callout_warning'].includes(cmd.id)) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const rawLineEnd = value.indexOf('\n', lineStart);
    const lineEnd = rawLineEnd === -1 ? value.length : rawLineEnd;
    const currentLine = value.substring(lineStart, lineEnd);

    let linePrefixRegex = null;
    if (cmd.id === 'checklist') linePrefixRegex = /^-\s*\[[ xX]\]\s*/;
    else if (cmd.id === 'quote') linePrefixRegex = /^>\s*/;
    else if (cmd.id === 'callout_info') linePrefixRegex = /^>\s*\[!info\]\s*/i;
    else if (cmd.id === 'callout_warning') linePrefixRegex = /^>\s*\[!warning\]\s*/i;

    const existingMatch = linePrefixRegex ? currentLine.match(linePrefixRegex) : null;
    let newLine = '';
    let cursorDelta = 0;

    if (existingMatch) {
      newLine = currentLine.substring(existingMatch[0].length);
      cursorDelta = -existingMatch[0].length;
    } else {
      newLine = prefix + currentLine;
      cursorDelta = prefix.length;
    }

    textarea.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd);
    const newPos = Math.max(lineStart, start + cursorDelta);
    textarea.selectionStart = newPos;
    textarea.selectionEnd = newPos;
    return;
  }

  if (cmd.id === 'horizontal_rule') {
    const needsLeadNl = start > 0 && value[start - 1] !== '\n';
    const insert = (needsLeadNl ? '\n' : '') + '---\n';
    textarea.value = value.substring(0, start) + insert + value.substring(end);
    const newPos = start + insert.length;
    textarea.selectionStart = newPos;
    textarea.selectionEnd = newPos;
    return;
  }

  if (cmd.id === 'code_block') {
    const replacement = '```\n' + selectedText + '\n```';
    textarea.value = value.substring(0, start) + replacement + value.substring(end);
    const newPos = start + 4 + selectedText.length;
    textarea.selectionStart = newPos;
    textarea.selectionEnd = newPos;
    return;
  }

  // Comandos inline: sem texto inventado! Envolve a seleção ou posiciona cursor entre as tags
  const replacement = prefix + selectedText + suffix;
  textarea.value = value.substring(0, start) + replacement + value.substring(end);

  let newPos;
  if (cmd.id === 'link') {
    newPos = selectedText ? (start + replacement.length - 1) : (start + prefix.length);
  } else {
    newPos = selectedText ? (start + replacement.length) : (start + prefix.length);
  }
  textarea.selectionStart = newPos;
  textarea.selectionEnd = newPos;
}

function getInlineTagSelector(cmdId) {
  switch (cmdId) {
    case 'bold': return 'strong, b';
    case 'italic': return 'em, i';
    case 'highlight': return 'mark, .md-highlight';
    case 'strikethrough': return 'del, s, strike, .md-strikethrough';
    case 'code_inline': return 'code, .md-inline-code';
    case 'wikilink': return '.md-wikilink';
    case 'tag': return '.md-tag';
    case 'link': return '.md-link-inline, a';
    default: return null;
  }
}

function unwrapVisualElement(el) {
  const parent = el.parentNode;
  if (!parent) return null;
  let lastInserted = null;
  while (el.firstChild) {
    const child = el.firstChild;
    if (child.nodeType === Node.ELEMENT_NODE && (child.classList.contains('vl-wikilink-icon') || child.classList.contains('md-link-bracket'))) {
      el.removeChild(child);
      continue;
    }
    lastInserted = parent.insertBefore(child, el);
  }
  parent.removeChild(el);
  return lastInserted;
}

function applyCommandToVisual(cmd) {
  const visual = document.getElementById('card-content-visual');
  const textarea = document.getElementById('card-content-input');
  if (!visual || !textarea) return;

  visual.focus();
  const sel = window.getSelection();
  let range = null;

  if (savedVisualRange && visual.contains(savedVisualRange.commonAncestorContainer)) {
    range = savedVisualRange;
    sel.removeAllRanges();
    sel.addRange(range);
  } else if (sel.rangeCount > 0 && visual.contains(sel.getRangeAt(0).commonAncestorContainer)) {
    range = sel.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(visual);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  savedVisualRange = null;

  // 1. Comandos de Bloco (aplicam na linha atual garantindo tag no início da linha)
  if (['checklist', 'quote', 'callout_info', 'callout_warning'].includes(cmd.id)) {
    const lineEl = ensureCurrentVisualLine(visual, range);
    const rawLineText = stripZws((lineEl.querySelector('.visual-line-text') || lineEl).textContent).replace(/\u00a0/g, ' ');
    const preservedNodes = [];
    const sourceContainer = lineEl.querySelector('.visual-line-text') || lineEl;
    sourceContainer.childNodes.forEach(n => {
      if (n.nodeType === Node.ELEMENT_NODE && (n.classList.contains('visual-check-wrap') || n.classList.contains('visual-bullet') || n.classList.contains('visual-callout-badge') || n.tagName === 'BR')) {
        return;
      }
      preservedNodes.push(n.cloneNode(true));
    });

    const buildPlainLine = () => {
      const div = document.createElement('div');
      div.className = 'visual-line';
      preservedNodes.forEach(n => div.appendChild(n));
      if (!stripZws(div.textContent)) div.innerHTML = '<br>';
      lineEl.replaceWith(div);
      if (div.firstChild && div.firstChild.nodeType === Node.TEXT_NODE) {
        setCaretAt(div.firstChild, div.firstChild.textContent.length);
      } else {
        setCaretInsideElementEnd(div);
      }
    };

    if (cmd.id === 'checklist') {
      const existingIndent = parseInt(lineEl.dataset.indent || '0', 10) || getLineIndentLevel(rawLineText);
      if (lineEl.classList.contains('md-task-item')) {
        buildPlainLine();
      } else {
        const taskDiv = document.createElement('div');
        taskDiv.className = 'visual-line md-task-item';
        const wrap = document.createElement('span');
        wrap.className = 'visual-check-wrap';
        wrap.setAttribute('contenteditable', 'false');
        wrap.innerHTML = '<input type="checkbox" class="md-task-checkbox" />';
        const textSpan = document.createElement('span');
        textSpan.className = 'visual-line-text';
        const strippedRaw = rawLineText.replace(/^[\t ]+/, '');
        if (preservedNodes.length > 0 && stripZws(strippedRaw)) {
          // Remove tabs/espaços iniciais do primeiro nó se virou indentação do checklist
          if (preservedNodes[0].nodeType === Node.TEXT_NODE) {
            preservedNodes[0].textContent = preservedNodes[0].textContent.replace(/^[\t ]+/, '');
          }
          preservedNodes.forEach(n => textSpan.appendChild(n));
        } else {
          textSpan.textContent = '\u200B';
        }
        taskDiv.appendChild(wrap);
        taskDiv.appendChild(textSpan);
        setVisualLineIndent(taskDiv, existingIndent);
        lineEl.replaceWith(taskDiv);
        setCaretInsideElementEnd(textSpan);
      }
    } else if (cmd.id === 'quote') {
      if (lineEl.classList.contains('md-blockquote')) {
        buildPlainLine();
      } else {
        const qDiv = document.createElement('div');
        qDiv.className = 'visual-line md-blockquote';
        const textSpan = document.createElement('span');
        textSpan.className = 'visual-line-text';
        if (preservedNodes.length > 0 && stripZws(rawLineText)) {
          preservedNodes.forEach(n => textSpan.appendChild(n));
        } else {
          textSpan.textContent = '\u200B';
        }
        qDiv.appendChild(textSpan);
        lineEl.replaceWith(qDiv);
        setCaretInsideElementEnd(textSpan);
      }
    } else if (cmd.id === 'callout_info' || cmd.id === 'callout_warning') {
      const type = cmd.id === 'callout_info' ? 'info' : 'warning';
      if (lineEl.classList.contains('md-callout') && lineEl.dataset.calloutType === type) {
        buildPlainLine();
      } else {
        const cDiv = document.createElement('div');
        cDiv.className = `visual-line md-callout callout-${type}`;
        cDiv.dataset.calloutType = type;
        const badge = document.createElement('span');
        badge.className = 'visual-callout-badge';
        badge.setAttribute('contenteditable', 'false');
        badge.textContent = `💡 [${type}] `;
        const textSpan = document.createElement('span');
        textSpan.className = 'visual-line-text';
        if (preservedNodes.length > 0 && stripZws(rawLineText)) {
          preservedNodes.forEach(n => textSpan.appendChild(n));
        } else {
          textSpan.textContent = '\u200B';
        }
        cDiv.appendChild(badge);
        cDiv.appendChild(textSpan);
        lineEl.replaceWith(cDiv);
        setCaretInsideElementEnd(textSpan);
      }
    }

    textarea.value = visualEditorToMarkdown(visual);
    return;
  }

  if (cmd.id === 'horizontal_rule') {
    const lineEl = ensureCurrentVisualLine(visual, range);
    const hrDiv = document.createElement('div');
    hrDiv.className = 'visual-line md-visual-hr';
    hrDiv.setAttribute('contenteditable', 'false');
    hrDiv.innerHTML = '<hr class="md-hr" />';
    const nextLine = document.createElement('div');
    nextLine.className = 'visual-line';
    nextLine.innerHTML = '<br>';

    const isLineEmpty = !stripZws(lineEl.textContent).trim();
    if (isLineEmpty) {
      lineEl.replaceWith(hrDiv);
    } else {
      lineEl.after(hrDiv);
    }
    hrDiv.after(nextLine);
    setCaretAt(nextLine, 0);
    textarea.value = visualEditorToMarkdown(visual);
    return;
  }

  if (cmd.id === 'code_block') {
    const lineEl = ensureCurrentVisualLine(visual, range);
    const selText = stripZws(range.toString());
    const codeDiv = document.createElement('div');
    codeDiv.className = 'visual-line md-code-block';
    codeDiv.dataset.codeBlock = 'true';
    if (selText) {
      range.deleteContents();
      codeDiv.textContent = selText;
      if (!stripZws(lineEl.textContent).trim()) {
        lineEl.replaceWith(codeDiv);
      } else {
        lineEl.after(codeDiv);
      }
    } else {
      codeDiv.textContent = stripZws(lineEl.textContent) || '\u200B';
      lineEl.replaceWith(codeDiv);
    }
    setCaretInsideElementEnd(codeDiv);
    textarea.value = visualEditorToMarkdown(visual);
    return;
  }

  // 2. Comandos Inline (Bold, Italic, Highlight, Strikethrough, Code, Wikilink, Tag, Link)
  ensureCurrentVisualLine(visual, range);
  range = sel.getRangeAt(0);
  const tagSelector = getInlineTagSelector(cmd.id);
  const startEl = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const existingTag = tagSelector ? startEl?.closest(tagSelector) : null;

  // Se há texto selecionado
  if (!range.collapsed) {
    const selectedText = stripZws(range.toString());
    if (existingTag && visual.contains(existingTag) && ['bold', 'italic', 'highlight', 'strikethrough', 'code_inline'].includes(cmd.id)) {
      const last = unwrapVisualElement(existingTag);
      if (last) setCaretInsideElementEnd(last);
      textarea.value = visualEditorToMarkdown(visual);
      return;
    }

    range.deleteContents();
    const created = createVisualInlineElement(cmd.id, selectedText);
    range.insertNode(created.wrapper);

    if (created.focusAfterUrl && created.urlNode) {
      setCaretInsideElementEnd(created.urlNode);
    } else {
      const afterNode = document.createTextNode('\u200B');
      created.wrapper.after(afterNode);
      setCaretAt(afterNode, 1);
    }
    textarea.value = visualEditorToMarkdown(visual);
    return;
  }

  // Sem texto selecionado: se já estiver dentro da mesma tag de estilo, sai dela (toggle off)
  if (existingTag && visual.contains(existingTag) && ['bold', 'italic', 'highlight', 'strikethrough', 'code_inline'].includes(cmd.id)) {
    const afterNode = document.createTextNode('\u200B');
    existingTag.after(afterNode);
    setCaretAt(afterNode, 1);
    textarea.value = visualEditorToMarkdown(visual);
    return;
  }

  // Sem texto selecionado: insere apenas a tag vazia e coloca o cursor dentro (sem texto pronto!)
  const created = createVisualInlineElement(cmd.id, '');
  range.insertNode(created.wrapper);
  setCaretInsideElementEnd(created.caretTarget);
  textarea.value = visualEditorToMarkdown(visual);
}

function createVisualInlineElement(cmdId, textValue) {
  const hasText = Boolean(textValue);

  if (cmdId === 'bold') {
    const el = document.createElement('strong');
    el.textContent = hasText ? textValue : '\u200B';
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'italic') {
    const el = document.createElement('em');
    el.textContent = hasText ? textValue : '\u200B';
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'highlight') {
    const el = document.createElement('mark');
    el.className = 'md-highlight';
    el.textContent = hasText ? textValue : '\u200B';
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'strikethrough') {
    const el = document.createElement('del');
    el.className = 'md-strikethrough';
    el.textContent = hasText ? textValue : '\u200B';
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'code_inline') {
    const el = document.createElement('code');
    el.className = 'md-inline-code';
    el.textContent = hasText ? textValue : '\u200B';
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'wikilink') {
    const el = document.createElement('span');
    el.className = 'md-wikilink';
    el.dataset.wikilink = '1';
    const icon = document.createElement('span');
    icon.className = 'vl-wikilink-icon';
    icon.setAttribute('contenteditable', 'false');
    icon.textContent = '📄 ';
    const txt = document.createElement('span');
    txt.className = 'vl-wikilink-text';
    txt.textContent = hasText ? textValue : '\u200B';
    el.appendChild(icon);
    el.appendChild(txt);
    return { wrapper: el, caretTarget: txt };
  }
  if (cmdId === 'tag') {
    const el = document.createElement('span');
    el.className = 'md-tag';
    const clean = textValue.replace(/^#/, '');
    el.textContent = '#' + clean;
    return { wrapper: el, caretTarget: el };
  }
  if (cmdId === 'link') {
    const el = document.createElement('span');
    el.className = 'md-link-inline';
    const b1 = document.createElement('span');
    b1.className = 'md-link-bracket';
    b1.setAttribute('contenteditable', 'false');
    b1.textContent = '[';
    const lbl = document.createElement('span');
    lbl.className = 'md-link-text';
    lbl.textContent = hasText ? textValue : '\u200B';
    const b2 = document.createElement('span');
    b2.className = 'md-link-bracket';
    b2.setAttribute('contenteditable', 'false');
    b2.textContent = '](';
    const url = document.createElement('span');
    url.className = 'md-link-url';
    url.textContent = 'https://';
    const b3 = document.createElement('span');
    b3.className = 'md-link-bracket';
    b3.setAttribute('contenteditable', 'false');
    b3.textContent = ')';
    el.append(b1, lbl, b2, url, b3);
    return { wrapper: el, caretTarget: hasText ? url : lbl, focusAfterUrl: hasText, urlNode: url };
  }

  const span = document.createElement('span');
  span.textContent = textValue;
  return { wrapper: span, caretTarget: span };
}

// Modal de Configuração de Atalhos Editáveis
window.openHotkeysSettingsModal = function () {
  const modal = document.getElementById('hotkeys-settings-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  renderHotkeysSettingsList();
};

window.closeHotkeysSettingsModal = function () {
  const modal = document.getElementById('hotkeys-settings-modal');
  if (modal) modal.style.display = 'none';
};

window.resetDefaultHotkeys = function () {
  localStorage.removeItem('kanban_custom_hotkeys');
  renderHotkeysSettingsList();
  renderPaletteCommandsList();
};

let recordingCmdId = null;

function renderHotkeysSettingsList() {
  const container = document.getElementById('hotkeys-settings-list');
  if (!container) return;

  container.innerHTML = DEFAULT_COMMANDS.map(cmd => {
    const currentHotkey = getCommandHotkey(cmd);
    const isRecording = recordingCmdId === cmd.id;

    return `
      <div class="hotkey-setting-row">
        <div class="hotkey-setting-info">
          <div class="hotkey-setting-name">${cmd.icon} ${escapeHtml(cmd.name)}</div>
          <div class="hotkey-setting-tag">${escapeHtml(cmd.desc)}</div>
        </div>
        <div style="display: flex; gap: 6px; align-items: center;">
          <button type="button" 
                  class="hotkey-input-btn ${isRecording ? 'recording' : ''}" 
                  id="btn-hotkey-${cmd.id}" 
                  onclick="startRecordingHotkey('${cmd.id}')"
                  title="Clique e pressione o novo atalho de teclado">
            ${isRecording ? 'Pressione teclas...' : (currentHotkey || 'Nenhum')}
          </button>
          ${currentHotkey !== cmd.defaultHotkey ? `
            <button type="button" class="btn btn-sm" onclick="saveCustomHotkey('${cmd.id}', null)" title="Voltar ao padrão (${cmd.defaultHotkey})" style="font-size: 0.72rem; padding: 2px 6px;">↺</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.startRecordingHotkey = function (cmdId) {
  recordingCmdId = cmdId;
  renderHotkeysSettingsList();
};

// Escuta teclado global para captura de atalhos e gravação
function setupHotkeysListener() {
  window.addEventListener('keydown', (e) => {
    // 1. Se estiver gravando um atalho no modal de configurações
    if (recordingCmdId) {
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return; // Espera a tecla principal
      }
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        recordingCmdId = null;
        renderHotkeysSettingsList();
        return;
      }

      // Constrói string do atalho: ex Ctrl+Shift+H
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');

      let mainKey = e.key.toUpperCase();
      if (mainKey === ' ') mainKey = 'Space';
      if (mainKey === '/') mainKey = '/';
      if (mainKey === 'ENTER') mainKey = 'Enter';
      parts.push(mainKey);

      const hotkeyStr = parts.join('+');
      saveCustomHotkey(recordingCmdId, hotkeyStr);
      recordingCmdId = null;
      renderHotkeysSettingsList();
      return;
    }

    // 2. Se a paleta de comandos estiver aberta: navegação com setas / Enter / Esc
    const paletteModal = document.getElementById('command-palette-modal');
    if (paletteModal && paletteModal.style.display === 'flex') {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          paletteSelectedIndex = (paletteSelectedIndex + 1) % filteredCommands.length;
          renderPaletteCommandsList();
        }
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredCommands.length > 0) {
          paletteSelectedIndex = (paletteSelectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
          renderPaletteCommandsList();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[paletteSelectedIndex]) {
          executePaletteCommand(filteredCommands[paletteSelectedIndex].id);
        }
        return;
      }
    }

    // 3. Atalho para abrir a Command Palette: Ctrl+/ ou Alt+K
    if (((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === 'p' || e.key === 'P')) || (e.altKey && (e.key === 'k' || e.key === 'K'))) {
      e.preventDefault();
      if (paletteModal && paletteModal.style.display === 'flex') {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
      return;
    }

    // 4. Atalhos Markdown diretos: funcionam em AMBOS os modos (Visual e Texto Puro)
    const textarea = document.getElementById('card-content-input');
    const visual = document.getElementById('card-content-visual');
    const isTextareaFocused = document.activeElement === textarea;
    const isVisualFocused = Boolean(visual && (document.activeElement === visual || visual.contains(document.activeElement)));
    const cardModal = document.getElementById('card-modal');
    const isCardOpen = cardModal && cardModal.style.display === 'flex';

    // Suporte especial para Ctrl+Enter criar/alternar checklist em ambos os modos
    if ((isTextareaFocused || isVisualFocused) && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const checklistCmd = DEFAULT_COMMANDS.find(c => c.id === 'checklist');
      if (checklistCmd) applyCommandToEditor(checklistCmd);
      return;
    }

    if (!isTextareaFocused && !isVisualFocused && !isCardOpen) {
      return; // Não intercepta teclas se o usuário estiver fora do editor de cards
    }

    // Normaliza a combinação pressionada
    const pressedParts = [];
    if (e.ctrlKey) pressedParts.push('Ctrl');
    if (e.altKey) pressedParts.push('Alt');
    if (e.shiftKey) pressedParts.push('Shift');
    if (e.metaKey) pressedParts.push('Meta');

    let mainKey = e.key.toUpperCase();
    if (mainKey === ' ') mainKey = 'Space';
    if (mainKey === '/') mainKey = '/';
    if (mainKey === 'ENTER') mainKey = 'Enter';
    pressedParts.push(mainKey);
    const pressedHotkey = pressedParts.join('+');

    // Procura comando configurado que combine
    const matchedCmd = DEFAULT_COMMANDS.find(cmd => {
      const hotkey = getCommandHotkey(cmd);
      return hotkey.toUpperCase() === pressedHotkey.toUpperCase();
    });

    if (matchedCmd) {
      if (isTextareaFocused || isVisualFocused || isCardOpen) {
        e.preventDefault();
        applyCommandToEditor(matchedCmd);
      }
    }
  });
}

// Inicia escuta de atalhos e paleta
setupHotkeysListener();

// Inicia aplicação ao carregar
window.addEventListener('DOMContentLoaded', initKanban);

