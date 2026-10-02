# Build the bundled NZBDavEx backend for the target Alpine architecture.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS nzbdav-build

WORKDIR /backend
COPY vendor/nzbdavex/backend/ ./
ARG TARGETARCH
RUN case "$TARGETARCH" in \
            amd64) RID=linux-musl-x64 ;; \
            arm64) RID=linux-musl-arm64 ;; \
            *) echo "Unsupported target architecture: $TARGETARCH" && exit 1 ;; \
        esac && \
        dotnet publish NzbWebDAV.csproj --configuration Release --runtime "$RID" \
            --self-contained false --output /publish

# Runtime includes the .NET 10 ASP.NET shared framework and Node.js.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine

# Set working directory inside container
WORKDIR /usr/src/app

# Patch Alpine system packages (openssl etc.)
RUN apk upgrade --no-cache && apk add --no-cache nodejs npm

# Install dependencies
COPY package*.json ./
RUN apk add --no-cache python3 make g++ xz-dev && \
    npm ci --omit=dev && \
    apk del python3 make g++
ENV LOG_COLORS=always LOG_TIMESTAMPS=never

# Copy application code
COPY . .
COPY --from=nzbdav-build /publish ./vendor/nzbdavex/publish

# Expose the port the addon listens on
EXPOSE 7000

# Start Node directly to keep container logs focused on application events.
CMD ["node", "server.js"]
