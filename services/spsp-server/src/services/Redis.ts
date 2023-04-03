import Redis from 'ioredis'
import { Injector } from 'reduct'

import { Config } from './Config'

export class RedisService {
  public db: Redis.Redis
  constructor (deps: Injector) {
    const config = deps(Config)
    this.db = new Redis(config.redisHost)
  }
}
