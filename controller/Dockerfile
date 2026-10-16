# Builds the StellarForge ephemeral testnet operator.
#
#   docker build -t <registry>/stellar-forge-controller:latest controller
#
FROM rust:bookworm AS builder

WORKDIR /src

# Cache dependency compilation separately from sources.
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && printf 'fn main() {}' > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release --locked

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /src/target/release/stellar-forge-controller /usr/local/bin/stellar-forge-controller
ENTRYPOINT ["/usr/local/bin/stellar-forge-controller"]
