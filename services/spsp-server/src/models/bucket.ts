import Redis from 'ioredis'
import { Injector } from 'reduct'

import { create } from '../common/log'
import { RedisService } from '../services/Redis'

const log = create('bucketModel')

// TODO define a type interface for the "hash" object

export class BucketModel {
  private db: Redis.Redis


  constructor (deps: Injector) {
    this.db = deps(RedisService).db
  }

  public getReceiverSettingsKey (service: string, bucketId: string) {
    return `settings:${service}:${bucketId}`
  }

  public getReceiveKey (service: string, bucketId: string): string {
    return `sr:${service}:${bucketId}`
  }

  public getHashKey (service: string, bucketId: string): string {
    return `sh:${service}:${bucketId}`
  }

  public getPayKey (service: string, bucketId: string): string {
    return `sp:${service}:${bucketId}`
  }

  async getReceiverSettings (service: string, bucketId: string): Promise<object | void> {
    const settings = await this.db.get(this.getReceiverSettingsKey(service, bucketId))

    if (!settings) {
      return
    }

    try {
      return JSON.parse(settings)
    } catch (e) {
      log.error({e}, `malformed settings entry. service=${service} bucketId=${bucketId}`)
    }
  }

  async getReceiveAndHash (
    { amountReceivedKey, hashKey }:
    { amountReceivedKey: string, hashKey: string }
  ) {
    const [ amountReceived, hashString ] = await this.db.mget(amountReceivedKey, hashKey)
    // TODO: Remove non-null assertion
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { amountReceived: Number(amountReceived), hash: JSON.parse(hashString!) }
  }

  async getPaidAndHash (
    { amountPaidKey, hashKey }:
    { amountPaidKey: string, hashKey: string }
  ) {
    const [ amountPaid, hashString ] = await this.db.mget(amountPaidKey, hashKey)
    // TODO: Remove non-null assertion
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return { amountPaid: Number(amountPaid), hash: JSON.parse(hashString!) }
  }

  async receive (
    { bucketId, _amount, service }:
    { bucketId: string, _amount: number, service: string }
  ): Promise<number> {
    // This keeps track of the amount of bits owed. Needs to be re-calculated everytime payout occurs.
    const amountReceivedKey = this.getReceiveKey(service, bucketId)
    // Atomically increases amount received
    const newAmountReceived = await this.db.incrby(amountReceivedKey, _amount)
    log.info(`received payment for ${bucketId}: ${_amount}, new amount: ${newAmountReceived}`)
    return newAmountReceived
  }

  async pay (
    { bucketId, _amount, service }:
    { bucketId: string, _amount: number, service: string }
  ): Promise<number> {
    const amountPaidKey = this.getPayKey(service, bucketId)
    const newAmountPaid = await this.db.incrby(amountPaidKey, _amount)
    log.info(`paid for ${bucketId}: ${_amount}, new amount: ${newAmountPaid}`)
    return newAmountPaid
  }

  async get (bucketId: string): Promise<string | null> {
    try {
      const bucket = await this.db.get(bucketId)
      return bucket
    } catch (err) {
      log.error({err}, `Error fetching bucketId ${bucketId}`)
      if (err.notFound) {
        log.error(`Returning null for ${bucketId}`)
        return null
      }
      throw new Error(err)
    }
  }

  async getHash (bucketId: string) {
    const bucketString = await this.db.get(bucketId)
    if (!bucketString) {
      return null
    }
    return JSON.parse(bucketString)
  }

  async update (bucketId, newInfo) {
    try {
      await this.db.set(bucketId, newInfo)
      return newInfo
    } catch (err) {
      if (err) {
        log.error({err}, `Error updating bucket`)
        throw new Error(err)
      }
    }
  }

  async createHash (bucketId, fields, service) {
    try {
      // Set two hashes here, one with sr: and another sh:
      // One with amount received and another with more persistent info.
      const hashKey = this.getHashKey(service, bucketId)
      await this.db.set(hashKey, JSON.stringify(fields))
    } catch (err) {
      log.error({err}, `Error creating new bucket: ${bucketId}`)
      throw new Error(err)
    }
  }

  iterateDb (
    service: string,
    func: (keys: string[]) => Promise<void>,
    callback: () => void
  ) {
    const stream = this.db.scanStream({
      match: `sh:${service}:*`
    })

    stream.on('data', resultKeys => {
      // Only scan new keys when done with the old ones.
      // See: https://github.com/luin/ioredis#streamify-scanning
      stream.pause()
      func(resultKeys).then(() => stream.resume())
    })

    const done = (err?: Error): void => {
      if (err) log.error({err}, `iterateDb error: ${err.message}`)
      stream.removeListener('end', done)
      stream.removeListener('error', done)
      callback()
    }

    stream.once('end', done)
    stream.once('error', done)
  }

  delete (bucketKey: string) {
    this.db.del(bucketKey)
  }

  mexpire (bucketArray, timeout) {
    bucketArray.forEach(key => this.db.expire(key, timeout))
  }
}
