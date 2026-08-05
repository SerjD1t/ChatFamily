FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /familychat .

FROM alpine:3.21
RUN adduser -D -H app
USER app
WORKDIR /app
COPY --from=build /familychat /usr/local/bin/familychat
COPY --from=build /src/web /app/web
EXPOSE 8080
ENTRYPOINT ["familychat"]
