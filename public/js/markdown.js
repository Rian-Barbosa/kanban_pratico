/**
 * Escapa caracteres HTML perigosos para prevenir ataques XSS (Cross-Site Scripting).
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Valida URLs para evitar execução de esquemas perigosos como javascript:, data: ou vbscript:.
 */
function sanitizeUrl(url) {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^(https?:\/\/|\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

/**
 * Renderizador de Markdown Estendido para cards do Kanban.
 * Suporta:
 * - Checklists / Task lists (- [ ] e - [x]) com checkboxes interativos ou renderizados
 * - Destaque (==texto==)
 * - Tachado (~~texto~~)
 * - Negrito (**texto** ou __texto__) e Itálico (*texto* ou _texto_)
 * - Tags inline (#tag, #projeto/subtag)
 * - Cabeçalhos (# a ######)
 * - Citações / Blockquotes (> texto) e Callouts (> [!tipo])
 * - Anexos e imagens locais (![[arquivo.png]] e ![[arquivo.png|200]])
 * - Links internos / Wikilinks ([[Nota]] e [[Nota|Texto]])
 * - Links externos e imagens normais ([texto](url) e ![alt](url))
 * - Blocos de código (``` e `inline`)
 * - Linhas horizontais (---)
 * - Comentários ocultos (%% comentário %%)
 */
export function renderCardMarkdown(rawText) {
  if (!rawText) return '';

  // 1. Remove comentários do Obsidian %% comentário %%
  let text = rawText.replace(/%%[\s\S]*?%%/g, '');

  // 2. Escapa caracteres perigosos (XSS guard)
  let html = escapeHtml(text);

  // 3. Fenced Code Blocks (```linguagem ... ```)
  html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre class="md-code-block"><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // 4. Inline Code (`código`)
  html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

  // 5. Anexos e imagens com redimensionamento do Obsidian ![[imagem.png]] ou ![[imagem.png|300]]
  html = html.replace(/!\[\[(.*?)\]\]/g, (match, inner) => {
    const parts = inner.split('|');
    const filename = parts[0].trim().replace(/[<>:"/\\|?*]/g, '');
// Validação estrita de número para largura de imagem
    const cleanWidth = parts[1] && /^\d+$/.test(parts[1].trim()) ? parseInt(parts[1].trim(), 10) : null;
    const width = cleanWidth ? `style="max-width: ${cleanWidth}px;"` : '';
    return `<img src="/attachments/${encodeURIComponent(filename)}" alt="${escapeHtml(filename)}" class="md-img" ${width} loading="lazy" />`;
  });

  // 6. Imagens normais em markdown: ![alt](/attachments/...)
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
    const safeUrl = sanitizeUrl(url);
    return `<img src="${safeUrl}" alt="${alt}" class="md-img" loading="lazy" />`;
  });

  // 7. Wikilinks [[Nota]] ou [[Nota|Texto Exibido]] - clicável para abrir projeto ou nota
  html = html.replace(/\[\[(.*?)\]\]/g, (match, inner) => {
    const parts = inner.split('|');
    const target = parts[0].trim().replace(/[<>'"&]/g, '');
    const display = parts[1] ? parts[1].trim().replace(/[<>'"&]/g, '') : target;
    return `<span class="md-wikilink" data-target="${escapeHtml(target)}" onclick="window.handleWikilinkClick(event, this)" title="Abrir projeto / nota: ${target}">📄 ${display}</span>`;
  });

  // 8. Links externos seguros: [texto](url)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, linkText, url) => {
    const safeUrl = sanitizeUrl(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${linkText}</a>`;
  });

  // 9. Destaque do Obsidian ==texto destacado==
  html = html.replace(/==(.*?)==/g, '<mark class="md-highlight">$1</mark>');

  // 10. Tachado ~~texto riscado~~
  html = html.replace(/~~(.*?)~~/g, '<del class="md-strikethrough">$1</del>');

  // 11. Negrito e Itálico
  html = html
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.*?)__/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/_([^\s_].*?[^\s_])_/g, '<em>$1</em>');

  // 12. Processamento Linha a Linha (Listas, Checklists, Cabeçalhos, Callouts e Citações)
  const lines = html.split('\n');
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Linha horizontal (--- ou ***)
    if (/^(\*{3,}|-{3,})$/.test(trimmed)) {
      processedLines.push('<hr class="md-hr" />');
      continue;
    }

    // Task list / Checklists do Obsidian (- [ ] ou - [x] ou - [-])
    if (/^-\s*\[ \]\s*(.*)$/.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[ \]\s*/, '');
      processedLines.push(`<div class="md-task-item"><input type="checkbox" class="md-task-checkbox" data-task-idx="${i}" onclick="window.handleTaskToggle(event, this)" /> <span>${content}</span></div>`);
      continue;
    }
    if (/^-\s*\[x\]\s*(.*)$/i.test(trimmed)) {
      const content = trimmed.replace(/^-\s*\[x\]\s*/i, '');
      processedLines.push(`<div class="md-task-item completed"><input type="checkbox" checked class="md-task-checkbox" data-task-idx="${i}" onclick="window.handleTaskToggle(event, this)" /> <span class="md-task-done">${content}</span></div>`);
      continue;
    }

    // Callouts do Obsidian (> [!info] Título ou > [!tip], etc)
    const calloutMatch = trimmed.match(/^&gt;\s*\[!([a-zA-Z0-9_-]+)\]\s*(.*)$/);
    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase();
      const title = calloutMatch[2] || type.toUpperCase();
      processedLines.push(`<div class="md-callout callout-${type}"><div class="md-callout-title">💡 ${title}</div>`);
      continue;
    }

    // Blockquotes padrão (> texto)
    if (/^&gt;\s*(.*)$/.test(trimmed)) {
      const content = trimmed.replace(/^&gt;\s*/, '');
      processedLines.push(`<blockquote class="md-blockquote">${content}</blockquote>`);
      continue;
    }

    // Cabeçalhos (# H1 a ###### H6)
    if (/^######\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h6 class="md-h6">${trimmed.replace(/^######\s+/, '')}</h6>`);
      continue;
    }
    if (/^#####\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h5 class="md-h5">${trimmed.replace(/^#####\s+/, '')}</h5>`);
      continue;
    }
    if (/^####\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h4 class="md-h4">${trimmed.replace(/^####\s+/, '')}</h4>`);
      continue;
    }
    if (/^###\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h3 class="md-h3">${trimmed.replace(/^###\s+/, '')}</h3>`);
      continue;
    }
    if (/^##\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h2 class="md-h2">${trimmed.replace(/^##\s+/, '')}</h2>`);
      continue;
    }
    if (/^#\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<h1 class="md-h1">${trimmed.replace(/^#\s+/, '')}</h1>`);
      continue;
    }

    // Lista não-ordenada simples (- item ou * item)
    if (/^[-*+]\s+(.*)$/.test(trimmed)) {
      processedLines.push(`<div class="md-list-item">• ${trimmed.replace(/^[-*+]\s+/, '')}</div>`);
      continue;
    }

    // Tags inline (#tag ou #projeto/etapa) - clicável para filtrar
    line = line.replace(/(^|\s)#([a-zA-Z0-9_\-\/]+)(?=\s|$)/g, '$1<span class="md-tag" data-tag="$2" onclick="window.handleTagClick(event, this)" title="Filtrar por #$2">#$2</span>');

    processedLines.push(line);
  }

  return processedLines.join('<br/>');
}
