FROM node:20-bookworm-slim

WORKDIR /app/frontend

RUN corepack enable

COPY frontend/package.json frontend/yarn.lock /app/frontend/
RUN yarn install --frozen-lockfile

COPY frontend /app/frontend

EXPOSE 3000

CMD ["yarn", "start"]
