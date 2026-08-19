FROM node:26.7.0-bookworm-slim@sha256:cd565714d4da3e84bfd341e31448f81d47c6362198f152345297c9c1154e6341 AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/app/package.json apps/app/package.json
COPY packages packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build

FROM base AS runtime-packages
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg poppler-utils \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# Operational jobs retain the compiled workspace and scripts they invoke, but
# never inherit arbitrary build-context files or local environment files.
FROM runtime-packages AS ops-runtime
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/tsconfig.base.json /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/scripts /app/scripts
COPY --from=build /app/apps/app/package.json /app/apps/app/package.json
RUN install -d -o node -g node /backups
USER node

# Validation-only target used by scripts/container-image-policy.mjs to inspect
# the effective Docker build context. Production builds never select it.
FROM scratch AS context-policy-probe
COPY . /context

# The serving image contains only Nitro's self-contained production output.
# Source, tests, package managers, build dependencies and workspace artifacts do
# not cross this stage boundary. Keep this as the final stage so an unqualified
# docker build still produces the serving image.
FROM base AS app-runtime
COPY --from=build --chown=node:node /app/apps/app/.output /app/apps/app/.output
# The serving process invokes Node directly. Package managers are build/ops
# tooling, and retaining their dependency trees in the final image adds CVEs
# and executable surface with no runtime benefit.
RUN rm -rf \
  /opt/yarn-v1.22.22 \
  /usr/local/lib/node_modules/corepack \
  /usr/local/lib/node_modules/npm \
  && rm -f \
  /usr/local/bin/corepack \
  /usr/local/bin/npm \
  /usr/local/bin/npx \
  /usr/local/bin/pnpm \
  /usr/local/bin/pnpx \
  /usr/local/bin/yarn \
  /usr/local/bin/yarnpkg
USER node
EXPOSE 3000
CMD ["node", "apps/app/.output/server/index.mjs"]
