FROM node:14-alpine AS build
WORKDIR /app
RUN apk add --no-cache make gcc g++ python3

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY packages ./packages
COPY services ./services
COPY protos ./protos

RUN yarn workspaces focus @coilhq/connector \
  && yarn workspaces foreach -ptvR --from @coilhq/connector run build \
  && yarn workspaces focus --production @coilhq/connector

FROM node:14-alpine
WORKDIR /app

COPY --from=build /app ./

WORKDIR /app/services/connector

ENTRYPOINT [ "yarn", "start" ]
