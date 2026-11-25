FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/sable.db
ENV PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/index.js"]
