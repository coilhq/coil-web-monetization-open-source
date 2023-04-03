FROM node:14 AS build
WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY packages ./packages
COPY services ./services
COPY protos ./protos

RUN yarn workspaces focus @coilhq/spsp-server \
  && yarn workspaces foreach -ptvR --from @coilhq/spsp-server run build \
  && yarn workspaces focus --production @coilhq/spsp-server

FROM node:14-slim
WORKDIR /app

COPY --from=build /app ./

WORKDIR /app/services/spsp-server

EXPOSE 8080
ENTRYPOINT ["yarn", "start"]
