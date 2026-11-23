FROM node:20-alpine
WORKDIR /app
# backend (gateway + cloud) + the app it serves
COPY backend/package.json backend/
RUN cd backend && npm install mqtt@5 --no-audit --no-fund
COPY backend/ backend/
COPY shared/ shared/
COPY frontend/ frontend/
COPY media/ media/
EXPOSE 8080
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
CMD ["node", "backend/src/server.js"]
