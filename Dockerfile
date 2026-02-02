FROM node:24-alpine
WORKDIR /app

# Copy package files and Prisma schema
COPY package.json ./
COPY package-lock.json ./
COPY prisma ./prisma

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the TypeScript application and copy build-time assets needed at runtime
RUN npm run build \
  && mkdir -p dist/generated \
  && cp -r src/generated/prisma dist/generated/ \
  && mkdir -p dist/modules/mail \
  && cp -r src/modules/mail/templates dist/modules/mail/templates

# Expose port
EXPOSE 8000

# Start the application
CMD ["node", "dist/index.js"]
