import { Injector } from 'reduct'
import axios from 'axios'

import { Config } from './Config'

export class Rates {
  private config: Config
  private xrpUsdRate?: number
  private xrpUsdDate = 0
  private rateLifetime = 2000
  private xrpRatePromise?: Promise<number>

  constructor (deps: Injector) {
    this.config = deps(Config)
  }

  private async refetchXrpUsdRate (): Promise<number> {
    this.xrpUsdRate = Number((await axios({
      method: 'POST',
      url: `${this.config.barkerHost}/xrpusd`
    })).data)

    if (!this.xrpUsdRate) {
      throw new Error('could not load xrp usd rate')
    }

    this.xrpUsdDate = Date.now()
    return this.xrpUsdRate
  }

  private async getXrpUsdRate (): Promise<number> {
    if (!this.config.barkerHost) {
      throw new Error('no BARKER_HOST configured')
    }

    if (this.xrpRatePromise) {
      return this.xrpRatePromise
    }

    if (!this.xrpUsdRate || Date.now() - this.xrpUsdDate > this.rateLifetime) {
      try {
        this.xrpRatePromise = this.refetchXrpUsdRate()
        await this.xrpRatePromise
      } finally {
        delete this.xrpRatePromise
      }
    }

    if (!this.xrpUsdRate) {
      throw new Error('xrp usd rate was not fetched')
    }

    return this.xrpUsdRate
  }

  async convertToAsset (assetCode: string, xrpAmount: number): Promise<number> {
    switch (assetCode) {
      case 'USD':
        const xrpUsdRate = await this.getXrpUsdRate()
        return Math.floor(xrpAmount * xrpUsdRate)

      case 'XRP':
        return xrpAmount

      default:
        throw new Error('unknown asset code ' + assetCode)
    }
  }

  async usdToXRP (nanoUsdAmount: number): Promise<number> {
    const xrpUsdRate = await this.getXrpUsdRate()
    return Math.floor(nanoUsdAmount / xrpUsdRate)
  }
}
