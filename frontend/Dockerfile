FROM node:20-alpine AS build
WORKDIR /app

# Inject the backend API URL at build time for Vite.
ARG BACKEND_API_URL=/api
ENV BACKEND_API_URL=${BACKEND_API_URL}

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
