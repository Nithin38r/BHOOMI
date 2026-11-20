FROM node:20-alpine
WORKDIR /app
# backend + the static frontends it serves
COPY backend/package.json backend/
RUN cd backend && npm install mqtt@5 --no-audit --no-fund
COPY backend/ backend/
COPY index.html ./
COPY shared/ shared/
COPY stage-1-single-soil-node/ stage-1-single-soil-node/
EXPOSE 8080
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
CMD ["node", "backend/src/server.js"]
