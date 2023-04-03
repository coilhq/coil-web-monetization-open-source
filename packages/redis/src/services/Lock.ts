import { v4 as uuid } from 'uuid'

import { Redis } from './Redis'
import { Log, Logger } from './Log'

export interface LockHandle {
  release: () => Promise<void>
}

export const LOCK_EXPIRY = 30 * 1000
export const LOCK_REFRESH_INTERVAL = 10 * 1000

export class LockError extends Error {
  public constructor (...args: any) {
    super(...args)
    this.name = 'LockError'
  }
}

export class Lock {
  private redis: Redis
  private log: Logger

  public constructor (redis: Redis) {
    this.redis = redis
    this.log = new Log().log
  }

  public async acquire (key: string): Promise<LockHandle> {
    const signature = uuid()
    const result = await this.redis
      .instance()
      .set(key, signature, 'nx', 'px', LOCK_EXPIRY)

    if (!result) {
      throw new LockError('Lock could not be acquired. key=' + key)
    }

    const lockInterval = setInterval((): void => {
      this.redis
        .instance()
        .refreshIfEqual(key, signature, LOCK_EXPIRY)
        .catch((e: Error): void => {
          this.log.error({
            msg: 'failed to refresh lock.',
            key,
            signature,
            error: e.message
          })
        })
    }, LOCK_REFRESH_INTERVAL)

    return {
      release: async (): Promise<void> => {
        clearInterval(lockInterval)
        await this.redis
          .instance()
          .deleteIfEqual(key, signature)
          .catch((err: Error): void => {
            this.log.error({
              msg: 'error releasing lock!',
              key,
              error: err.message
            })
            throw err
          })
      }
    }
  }
}
