FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS web-build
WORKDIR /src
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run typecheck && npm test && npm run build

# 試作候補: candidates/fetch.sh が取り出した各版を /kohako/candidates/<id>/ 用に個別ビルドする。
FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS candidates-build
ARG REQUIRE_CANDIDATES=0
COPY --from=web-build /src/node_modules /deps/node_modules
COPY web/package-lock.json /deps/package-lock.json
COPY candidates/ /cand/
RUN REQUIRE_CANDIDATES=$REQUIRE_CANDIDATES sh /cand/build.sh /cand /deps /out

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS bff-build
WORKDIR /src
COPY bff/package*.json ./
RUN npm ci
COPY bff/ ./
RUN npm run typecheck && npm test && npm run build

# BOXP-501: runtime dependencies only (web-push), without the test/typecheck toolchain.
FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS bff-deps
WORKDIR /src
COPY bff/package*.json ./
RUN npm ci --omit=dev

FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1
RUN apt-get update && apt-get install -y --no-install-recommends nginx && rm -rf /var/lib/apt/lists/* && mkdir -p /tmp/nginx /srv/www/kohako && chown -R node:node /tmp/nginx /srv/www
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /src/dist/ /srv/www/kohako/
COPY --from=candidates-build /out/ /srv/www/kohako/candidates/
COPY --from=bff-build /src/dist/ /srv/bff/
COPY bff/package.json /srv/bff/package.json
COPY --from=bff-deps /src/node_modules /srv/bff/node_modules
USER node
EXPOSE 8080 8787
CMD ["node", "/srv/bff/server.js"]
