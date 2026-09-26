FROM golang:1.23-alpine AS builder

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /novel-sync ./cmd/server

FROM alpine:3.21

RUN apk add --no-cache ca-certificates wget \
    && addgroup -S -g 10001 novelsync \
    && adduser -S -D -H -u 10001 -G novelsync novelsync \
    && mkdir -p /data \
    && chown novelsync:novelsync /data

COPY --from=builder /novel-sync /usr/local/bin/novel-sync

USER novelsync
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
VOLUME ["/data"]

CMD ["/usr/local/bin/novel-sync"]
