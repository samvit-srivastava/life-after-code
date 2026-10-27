FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE
ARG VITE_GITLAB_PROJECT_URL
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_GITLAB_PROJECT_URL=$VITE_GITLAB_PROJECT_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
