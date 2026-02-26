# Build stage
FROM node:20 AS builder

WORKDIR /app

# Install dependencies needed for Electron build on Linux
RUN apt-get update && apt-get install -y \
    libcups2 \
    libdbus-1-3 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# In a real Docker scenario for Electron, we might just build the app here
# or run it using X11 forwarding. For now, we'll set up the run environment.

# Runtime stage
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies for Electron
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app /app

# Set environment variable for X11
ENV DISPLAY=:0

# Run the app (requires X11 forwarding from host)
CMD ["npm", "start"]
