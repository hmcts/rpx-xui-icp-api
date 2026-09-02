FROM hmctsprod.azurecr.io/base/node:24-alpine AS base

USER hmcts

COPY --chown=hmcts:hmcts .yarn ./.yarn
COPY --chown=hmcts:hmcts .yarnrc.yml ./
COPY --chown=hmcts:hmcts . .
RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"


# ---- Build image ----
FROM base AS build
RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# ---- Runtime image ----
FROM base AS runtime
COPY --from=build $WORKDIR/api ./api
COPY --from=build $WORKDIR/app.ts $WORKDIR/server.ts ./

EXPOSE 8080
