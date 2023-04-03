import { logFactory } from '@coilhq/metrics'

export class Log {
  public log = logFactory({
    level: process.env.LOG_LEVEL || 'info',
    name: 'redeemer'
  })
}
