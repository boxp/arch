FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS web-build
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS bff-build
WORKDIR /src
COPY bff/package*.json ./
RUN npm ci
COPY bff/ ./
RUN npm run typecheck && npm test && npm run build

FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* && mkdir -p /tmp/nginx /srv/www/kohako && chown -R node:node /tmp/nginx /srv/www
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /src/dist/ /srv/www/kohako/
COPY --from=bff-build /src/dist/ /srv/bff/
COPY bff/package.json /srv/bff/package.json
USER node
EXPOSE 8080 8787
CMD ["node", "/srv/bff/server.js"]
