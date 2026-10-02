# One image, two processes: the API (default) and the worker.
#
#   API:     docker run … tender-api                 (npm start)
#   Worker:  docker run … tender-api npm run worker
#   Release: docker run … tender-api npx prisma migrate deploy
#
# Dev dependencies stay in the image on purpose: the release step needs the
# Prisma CLI, and `postinstall` runs `prisma generate`.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN npm ci
COPY tsconfig.build.json ./
COPY src ./src
COPY contract ./contract
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["npm", "start"]
