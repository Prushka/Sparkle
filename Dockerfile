FROM node:lts AS build

WORKDIR /app

ENV NODE_OPTIONS="--max_old_space_size=4096"

COPY package*.json .

RUN npm ci

COPY . .
RUN npm run build

FROM node:lts AS run

ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
ENTRYPOINT ["node", "server.js"]
