FROM node:lts AS build

WORKDIR /app

ENV NODE_OPTIONS="--max_old_space_size=4096"

COPY package*.json .

RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --production

FROM node:lts AS run

ENV NODE_ENV=production

WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
ENTRYPOINT ["node", "build"]
