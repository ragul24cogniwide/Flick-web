# Flick Web: built once with Vite, then served as static files by nginx
#
#   docker build -t flick-web .                                              # talks to the Render backend
#   docker build -t flick-web --build-arg VITE_FLICK_API=http://localhost:8000 .   # talks to a local backend
#   docker run -p 8080:80 flick-web                                          # open http://localhost:8080
#
# The backend address is fixed at build time (it is also written into the page's security policy),
# so build a separate image for each backend.

# ---- Build ------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG VITE_FLICK_API=https://pocket-backend-7lmx.onrender.com
ENV VITE_FLICK_API=${VITE_FLICK_API}
RUN npm run build

# ---- Serve ------------------------------------------------------------------
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
