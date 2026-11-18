FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/database /app/public/uploads/repairs
EXPOSE 3000
CMD ["node", "server.js"]
