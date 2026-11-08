FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS web-build
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS bff-build
WORKDIR /src
COPY bff/package*.json ./
RUN npm ci
COPY bff/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* && mkdir -p /tmp/nginx /srv/www/kohako && chown -R node:node /tmp/nginx /srv/www
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /src/dist/ /srv/www/kohako/
COPY --from=bff-build /src/dist/ /srv/bff/
COPY bff/package.json /srv/bff/package.json
USER node
EXPOSE 8080 8787
CMD ["node", "/srv/bff/server.js"]
