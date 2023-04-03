import { logFactory, Logger } from '@coilhq/metrics'

import { Config } from './Config'

export { Logger }

export class Log {
  public log: Logger = logFactory({ name: 'coil-redis' })
  private config = new Config()

  public constructor () {
    this.log.level = this.config.logLevel
  }
}
