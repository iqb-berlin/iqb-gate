# Built from the repository root: docker build -f packages/gateway/Dockerfile -t iqbberlin/iqb-gate .
FROM node:24.20.0-alpine AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/gateway/package.json packages/gateway/
RUN npm ci --workspace @iqb/gate-protocol --workspace @iqb/gate-gateway --include-workspace-root
COPY packages/protocol packages/protocol
COPY packages/gateway packages/gateway
RUN npm run build --workspace @iqb/gate-protocol \
 && npm run build --workspace @iqb/gate-gateway \
 && npm ci --workspace @iqb/gate-protocol --workspace @iqb/gate-gateway --omit=dev

FROM node:24.20.0-alpine
ENV NODE_ENV=production
WORKDIR /app
# The same layout as in the repository, so that the workspace link to the protocol resolves
COPY --from=build /build/node_modules node_modules
COPY --from=build /build/packages/protocol/package.json packages/protocol/
COPY --from=build /build/packages/protocol/dist packages/protocol/dist
COPY --from=build /build/packages/gateway/package.json packages/gateway/
COPY --from=build /build/packages/gateway/dist packages/gateway/dist
# The audit log of checked writes
RUN mkdir -p /var/lib/iqb-gate && chown node:node /var/lib/iqb-gate
VOLUME /var/lib/iqb-gate
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["node", "packages/gateway/dist/healthcheck.js"]
CMD ["node", "packages/gateway/dist/main.js"]
