FROM node:24-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM rust:1-slim AS rust-build
WORKDIR /build/server
COPY server/Cargo.toml server/Cargo.lock ./
RUN mkdir src && printf 'fn main() {}\n' > src/main.rs && cargo build --release && rm -rf src
COPY --from=frontend-build /build/frontend/dist /build/frontend/dist
COPY server/src/ src/
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN useradd -u 1000 -M folio && \
    mkdir -p /data /backups && \
    chown folio:folio /data /backups
COPY --from=rust-build /build/server/target/release/folio-server /usr/local/bin/
USER folio
VOLUME ["/data", "/backups"]
ENV FOLIO_DATA_DIR=/data
ENTRYPOINT ["folio-server"]
