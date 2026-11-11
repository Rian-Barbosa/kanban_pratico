# Imagem ultra-leve baseada em Alpine Linux
FROM node:22-alpine AS builder

# Instalar ferramentas de compilação necessárias para o Argon2 (C++)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Instalar dependências
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Estágio final de execução (mínimo de arquivos e superfície de ataque)
FROM node:22-alpine

# Definir ambiente de produção
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /app

# Copiar dependências compiladas do builder
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Copiar código-fonte da aplicação
COPY server/ ./server/
COPY public/ ./public/

# Criar pasta data com permissões adequadas
RUN mkdir -p /app/data/vaults /app/data/attachments && chown -R node:node /app

# Executar como usuário não-root (boa prática de segurança)
USER node

# Expor a porta interna do container
EXPOSE 3000

# Inicialização
CMD ["node", "server/server.js"]

