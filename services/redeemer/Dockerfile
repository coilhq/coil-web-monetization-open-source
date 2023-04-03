FROM node:14-slim AS build
WORKDIR /app

# Add Python becase apparently we need that now
RUN apt-get update || : && apt-get install python make g++ -y

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY packages ./packages
COPY services ./services
COPY protos ./protos

RUN yarn workspaces focus @coilhq/redeemer \
  && yarn workspaces foreach -ptvR --from @coilhq/redeemer run build \
  && yarn workspaces focus --production @coilhq/redeemer

FROM node:14-slim
WORKDIR /app

COPY --from=build /app ./

WORKDIR /app/services/redeemer

EXPOSE 3021
ENTRYPOINT [ "yarn", "start" ]
