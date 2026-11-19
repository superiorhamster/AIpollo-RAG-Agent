FROM golang:1.26.11-bookworm AS build

RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z

FROM busybox:1.37.0-musl

LABEL org.opencontainers.image.source="https://github.com/minio/minio" \
      org.opencontainers.image.version="RELEASE.2025-10-15T17-29-55Z"

COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

EXPOSE 9000 9001
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 \
  CMD ["wget", "-qO", "/dev/null", "http://127.0.0.1:9000/minio/health/ready"]
ENTRYPOINT ["/usr/local/bin/minio"]
