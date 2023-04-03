FROM golang:1.18.3-bullseye as build
WORKDIR /app

RUN git clone 'https://github.com/coilhq/challenge-bypass-server.git' \
  && cd challenge-bypass-server/ \
  && git checkout '7a3ddffbd84c4f60e89dab03ac7a2482ab87337e' \
  && go mod init 'github.com/privacypass/challenge-bypass-server' \
  && mkdir cmd/coil-cbs
COPY services/cbs/*.go /app/challenge-bypass-server/cmd/coil-cbs/

# CGO_ENABLED=0 to statically compile. Alpine uses musl; Debian uses libc.
RUN cd challenge-bypass-server/ \
  && CGO_ENABLED=0 \
    go build \
    -v \
    -mod=mod \
    -o bin/coil-cbs \
    ./cmd/coil-cbs

FROM golang:1.18.3-alpine
WORKDIR /app
COPY --from=build /app/challenge-bypass-server/bin/coil-cbs /app
ENTRYPOINT [ "/app/coil-cbs" ]
