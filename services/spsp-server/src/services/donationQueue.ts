import { Injector } from 'reduct'
import Boom from 'boom'

import { BucketModel } from '../models/bucket'

import { Rates } from './Rates'

const SERVICE = 'donate'
const ILLEGAL_CHARACTERS = /[^A-Za-z0-9\-_]/

export class DonationQueue {
  private model: BucketModel
  private rates: Rates
  private DONATION_USERS: string[]

  constructor (deps: Injector) {
    this.model = deps(BucketModel)
    this.rates = deps(Rates)
    this.DONATION_USERS = [
    ]
  }

  async payBucket (bucketId: string, amount: number, meta?: object): Promise<number> {
    const assetCode = (meta && meta['assetCode']) || 'XRP'
    const convertedAmount = await this.rates.convertToAsset(assetCode, amount)

    return this.model.receive({
      bucketId: `${assetCode}:${bucketId}`,
      _amount: convertedAmount,
      service: SERVICE
    })
  }

  async payOut (bucketId: string, amount: number): Promise<number> {
    const result = await this.model.pay({
      bucketId,
      _amount: amount,
      service: SERVICE
    })
    return result
  }

  async verifyUser (_: string): Promise<void> {
    // this should not be reached because verify is skipped if metadata is found
    throw Boom.notFound('this is not an approved donate endpoint')
  }

  async getReceiverMetadata (bucketId: string): Promise<object | void> {
    if (bucketId.match(ILLEGAL_CHARACTERS)) {
      throw Boom.badRequest('invalid receiver; includes illegal characters')
    }

    if (this.DONATION_USERS.includes(bucketId)) {
      return { assetCode: 'XRP' }
    }

    return this.model.getReceiverSettings('donate', bucketId)
  }
}
