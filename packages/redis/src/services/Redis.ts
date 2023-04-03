import * as fs from 'fs'
import * as path from 'path'

import IORedis, { RedisOptions } from 'ioredis'

export interface RedisConfig {
  redisHost?: string
  redisPort?: number | string
  redisUri?: string
}

// add our newly defined command to interface
export interface ExtendedRedis extends IORedis.Redis {
  deleteIfEqual: (key: string, checkValue: string) => Promise<string>
  refreshIfEqual: (
    key: string,
    checkValue: string,
    duration: number
  ) => Promise<string>
  addToUsage: (
    usageKey: string,
    addNanoUsd: number,
    maximumAggregate: number
  ) => Promise<number>
  // maximumAggregate is not passed -- it is embedded as a constant in the Lua script.
  addSecondsToUsage: (usageKey: string, addSeconds: number) => Promise<string>
}

export type RedisClient = ExtendedRedis

// from https://redis.io/topics/distlock
const DELETE_IF_EQUAL_LUA = `
  if redis.call("get",KEYS[1]) == ARGV[1] then
      return redis.call("del",KEYS[1])
  else
      return 0
  end
`

const REFRESH_IF_EQUAL_LUA = `
  if redis.call("get",KEYS[1]) == ARGV[1] then
      return redis.call("set",KEYS[1],ARGV[1],"px",ARGV[2])
  else
      return 0
  end
`

const ADD_TO_USAGE_LUA = `
  redis.replicate_commands()
  local add_amount = tonumber(ARGV[1])
  local maximum_aggregate = tonumber(ARGV[2])
  local bucket = redis.call('get', KEYS[1])

  if bucket then
      bucket = cjson.decode(bucket)
  else
      bucket = {
        last=0,
        left=0,
        total=0,
        agg=0,
        in_flight=0
      }
  end

  local aggregate_amount = bucket["agg"] or 0
  local next_aggregate = aggregate_amount + add_amount

  if next_aggregate > maximum_aggregate then
    return 0
  end

  bucket["agg"] = next_aggregate
  redis.call("set", KEYS[1], cjson.encode(bucket))
  return 1
`

const ADD_SECONDS_TO_USAGE_LUA = fs
  .readFileSync(path.resolve(__dirname, '../../lua/addSecondsToUsage.lua'))
  .toString()

export class Redis {
  private config: RedisConfig | undefined
  private redis: ExtendedRedis
  public constructor (config?: RedisConfig) {
    this.config = config

    let redisOpts: RedisOptions | undefined
    let redisString: string = 'redis://localhost:6379'

    if (this.config) {
      if (this.config.redisUri) {
        redisString = this.config.redisUri
      } else if (this.config.redisHost && this.config.redisPort) {
        redisOpts = {
          host: this.config.redisHost,
          port: Number(this.config.redisPort)
        }
      }
    }

    if (redisOpts) {
      this.redis = new IORedis(redisOpts) as ExtendedRedis
    } else {
      this.redis = new IORedis(redisString) as ExtendedRedis
    }

    this.redis.defineCommand('deleteIfEqual', {
      numberOfKeys: 1,
      lua: DELETE_IF_EQUAL_LUA
    })

    this.redis.defineCommand('refreshIfEqual', {
      numberOfKeys: 1,
      lua: REFRESH_IF_EQUAL_LUA
    })

    this.redis.defineCommand('addToUsage', {
      numberOfKeys: 1,
      lua: ADD_TO_USAGE_LUA
    })

    this.redis.defineCommand('addSecondsToUsage', {
      numberOfKeys: 1,
      lua: ADD_SECONDS_TO_USAGE_LUA
    })
  }

  public instance (): ExtendedRedis {
    return this.redis
  }
}
