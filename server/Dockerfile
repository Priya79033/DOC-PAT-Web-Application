FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server ./server

ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "start"]
