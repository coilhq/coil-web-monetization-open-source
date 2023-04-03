import path from 'path'

import { Payout } from 'ilp-spsp-payout'
import { BigQuery, Table } from '@google-cloud/bigquery'
import { Injector } from 'reduct'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'

import { BucketModel } from '../models/bucket'
import { create } from '../common/log'

import { Config } from './Config'
import { promisify } from 'util'

const log = create('CoilContent')

const PROTO_PATH = path.resolve(__dirname, '../../../../protos/api.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH)
const apiProto = grpc.loadPackageDefinition(packageDefinition).coil['api']

interface BigQueryPayout {
  AMOUNT_PAID: number
  ASSET_SCALE: number
  CREATED_AT: number
  CURRENCY: string
  BUCKET_AMOUNT: number
  POST_ID?: string
  CREATOR_ID?: string
}

interface GrpcResponse {
  paymentPointer: string
}

export class CoilContent {
  private model: BucketModel
  private config: Config
  private service: string
  private bucketTimeout: number
  private payout: Payout
  private assetScale: number
  private bigQueryTable: Table
  private grpcServer: string
  private grpcClient: any // eslint-disable-line @typescript-eslint/no-explicit-any

  constructor (deps: Injector) {
    this.model = deps(BucketModel)
    this.config = deps(Config)
    this.service = 'coil-content'
    this.bucketTimeout = 60 * 60 * 6 * 1000
    this.payout = new Payout({
      slippage: 0.01,
      logger: create('ilp-spsp-payout')
    })
    const { datasetName, tableName } = this.config
    const bigQuery = new BigQuery({
      projectId: this.config.projectId
    })
    const dataset = bigQuery.dataset(datasetName)
    this.bigQueryTable = dataset.table(tableName)
    this.grpcServer = this.config.grpcServer
    this.grpcClient = new apiProto.CoilApi(
      this.grpcServer,
      grpc.credentials.createInsecure()
    )

  }

  setAssetScale (assetScale: number): void {
    this.assetScale = assetScale
  }

  async handleMoney (
    {
      user,
      amount,
      requestId,
      postId,
      creatorId
    }:
    {
      user: string
      amount: number
      requestId: string
      postId?: string
      creatorId?: string
    }
  ): Promise<void> {
    await this.fundBalance({ amount: amount, requestId })
    await this.payCreator({ amount: amount, requestId, postId, creatorId })
  }

  async handleQuery (
    {
      requestId,
      postId,
      creatorId
    }:
    {
      requestId: string
      postId?: string
      creatorId?: string
    }
  ): Promise<void> {
    try{
      const hashKey = this.model.getHashKey(this.service, requestId)
      const hashBucket = await this.model.getHash(hashKey)

      if (!hashBucket) {
        // Send GRPC call to API with postId to get user payment pointer
        // Set payment pointer in hash
        let response
        if (postId) {
          response = await this.getPostPaymentPointer(postId)
        } else if (creatorId) {
          response = await this.getCreatorPaymentPointer(creatorId)
        }
  
        if(!(response && response.paymentPointer)){
          log.warn({ requestId, postId, creatorId }, `Did not receive a paymentPointer from GRPC requests for postId=${postId} or creatorId=${creatorId}`)          
          return
        }
  
        this.setCreatorHash({
          requestId,
          paymentPointer: response && response.paymentPointer,
          creatorId,
          postId
        })
      }
    } catch (err) {
      log.warn({ err, postId, creatorId, requestId }, `handleQuery neither got nor set creator hashKey`)
    }
  }

  async getPostPaymentPointer (postId: string): Promise<GrpcResponse> {
    return await promisify(this.grpcClient.getPostPaymentPointer.bind(this.grpcClient))({
      postId
    })
  }

  async getCreatorPaymentPointer (creatorId: string): Promise<GrpcResponse> {
    return await promisify(this.grpcClient.getCreatorPaymentPointer.bind(this.grpcClient))({
      creatorId
    })
  }

  async fundBalance ({ amount: _amount, requestId }): Promise<void> {
    log.info(`Receiving payment for requestId= ${requestId}`)
    await this.model.receive({ bucketId: requestId, _amount, service: this.service })
  }

  async setCreatorHash ({ requestId, paymentPointer, postId, creatorId }): Promise<void> {
    const hashKey = this.model.getHashKey(this.service, requestId)
    const hashBucket = await this.model.getHash(hashKey)

    if (!hashBucket) {
      await this.model.createHash(
        requestId,
        {
          paymentPointer,
          postId,
          creatorId
        },
        this.service
      )
    }
  }

  async writeToBigQuery (
    { amount: _amount, requestId, postId, creatorId }:
    { amount: number, requestId: string, postId?: string, creatorId?: string }
  ): Promise<void> {
    const amountPaidKey = this.model.getPayKey(this.service, requestId)
    const amountPaid = await this.model.get(amountPaidKey)
    const timestamp = new Date().getTime() / 1000
    // Send to Big query

    const writeObj: BigQueryPayout = {
      AMOUNT_PAID: _amount,
      ASSET_SCALE: this.assetScale,
      CREATED_AT: timestamp,
      CURRENCY: 'XRP',
      BUCKET_AMOUNT: Number(amountPaid)
    }

    if (postId) {
      writeObj.POST_ID = postId
    }

    if (creatorId) {
      writeObj.CREATOR_ID = creatorId
    }
    await this.bigQueryTable.insert(writeObj).catch((err) => {
      // BigQuery PartialFailureError
      if (err.errors) {
        log.error(`bigquery insert error ${err.errors}`)
      }
      throw err
    })
  }

  async payCreator (
    {
      amount: _amount,
      requestId,
      postId,
      creatorId
    }:
    {
      amount: number
      requestId: string
      postId?: string
      creatorId?: string
    }
  ): Promise<void> {
    const hashKey = this.model.getHashKey(this.service, requestId)
    const hashBucket = await this.model.getHash(hashKey)
    try {
      if (!hashBucket) {
        throw new Error('No hash bucket associated with this requestId')
      } else {
        const paymentPointer = hashBucket.paymentPointer
        this.payout.send(paymentPointer, _amount)
        await this.model.pay({ bucketId: requestId, _amount, service: this.service })
        log.info(`success paying to payment pointer=${paymentPointer}`)
        // touch bucket to remove timeout
        this.touchConsumerBucket(requestId)
        this.writeToBigQuery({ amount: _amount, requestId, postId, creatorId })
      }
    } catch (err) {
      log.error({err})
      throw new Error(`Error paying to postId=${postId} creatorId=${creatorId}: ${err}`)
    }
  }

  touchConsumerBucket (requestId: string) {
    const amountReceivedKey = this.model.getReceiveKey(this.service, requestId)
    const amountPaidKey = this.model.getPayKey(this.service, requestId)
    const hashKey = this.model.getHashKey(this.service, requestId)
    this.model.mexpire([amountReceivedKey, amountPaidKey, hashKey], this.bucketTimeout)
  }

  async hasReceivedMoney ({ requestId, creatorId, postId }: { requestId: string, creatorId?: string, postId?: string }): Promise<boolean> {
    const amountReceivedKey = this.model.getReceiveKey(this.service, requestId)
    const amountReceived = await this.model.get(amountReceivedKey)
    const hashKey = this.model.getHashKey(this.service, requestId)
    const hashBucket = await this.model.getHash(hashKey)
    const postOrCreatorVerified = hashBucket && (hashBucket.creatorId === creatorId || hashBucket.postId === postId)
    return Number(amountReceived) > 0 && postOrCreatorVerified
  }
}
