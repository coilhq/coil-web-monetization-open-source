import Koa from 'koa'
import KoaRouter from 'koa-router'

import { Config } from './Config'
import { PayoutServer } from './PayoutServer'

export class App {
  private config: Config
  private server: PayoutServer

  constructor (deps) {
    this.config = deps(Config)
    this.server = deps(PayoutServer)
  }

  start () {
    void this.server.run()

    // Don't start this if running in dev mode
    if (!this.config.devMode) {
      const router = new KoaRouter()
      const app = new Koa()
      app
        .use(router.routes())
        .use(router.allowedMethods())
        .listen(this.config.metricsPort)
    }
  }
}
