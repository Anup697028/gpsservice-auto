FROM node:20-alpine AS build
WORKDIR /app

# Inject frontend API endpoints at build time for Vite.
ARG VITE_API_BASE_URL
ARG VITE_FO_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_FO_API_BASE_URL=${VITE_FO_API_BASE_URL}

# Copy dependency manifests first for better layer caching.
COPY package*.json ./
RUN npm ci

# Copy source and build the Vite app.
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Copy the built static files into Nginx web root.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
