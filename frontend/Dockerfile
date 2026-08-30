FROM node:24.20.0-alpine AS deps

WORKDIR /app

COPY package*.json ./

RUN npm ci


FROM node:24.20.0-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* é inlinado no bundle em build time, então precisa chegar
# como build arg (ver docker-compose.yml).
ARG NEXT_PUBLIC_API_URL=http://backend:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build


FROM node:24.20.0-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Saída "standalone" do Next.js: apenas o server.js e os node_modules
# realmente usados em runtime (ver next.config.ts).
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
