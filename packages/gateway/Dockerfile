# Built from the repository root: docker build -f packages/gateway/Dockerfile -t iqbberlin/iqb-gate .
FROM node:24.20.0-alpine AS build
WORKDIR /build
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/gateway/package.json packages/gateway/
RUN npm ci --workspace @iqb/gate-gateway --include-workspace-root
COPY packages/gateway packages/gateway
RUN npm run build --workspace @iqb/gate-gateway \
 && npm ci --workspace @iqb/gate-gateway --omit=dev

FROM node:24.20.0-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /build/node_modules node_modules
COPY --from=build /build/packages/gateway/package.json ./
COPY --from=build /build/packages/gateway/dist dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/main.js"]
