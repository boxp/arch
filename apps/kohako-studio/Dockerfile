FROM node:22-bookworm-slim AS web-build
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:22-bookworm-slim AS bff-build
WORKDIR /src
COPY bff/package*.json ./
RUN npm ci
COPY bff/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* && mkdir -p /tmp/nginx /srv/www/kohako && chown -R node:node /tmp/nginx /srv/www
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /src/dist/ /srv/www/kohako/
COPY --from=bff-build /src/dist/ /srv/bff/
COPY bff/package.json /srv/bff/package.json
USER node
EXPOSE 8080 8787
CMD ["node", "/srv/bff/server.js"]
