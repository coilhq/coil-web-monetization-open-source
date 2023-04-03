import * as path from 'path'

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { Injector } from 'reduct'

import {
  GetUserResponse,
  GrpcStatus,
  UserHasActiveSubscriptionResult
} from '../types/Grpc'

import { Config } from './Config'
import { Log } from './Log'

const PROTO_PATH = path.resolve(__dirname, '../../../../protos/auth.proto')
const packageDefinition = protoLoader.loadSync(PROTO_PATH)
const authProto = grpc.loadPackageDefinition(packageDefinition).coil['auth']

export class Grpc {
  public client: any
  private log: any

  public constructor (deps: Injector) {
    const config = deps(Config)
    this.client = new authProto.CoilAuth(
      config.grpcServer,
      grpc.credentials.createInsecure()
    )
    this.log = deps(Log).log
  }

  async userHasActiveSubscription (
    permanentId: string
  ): Promise<UserHasActiveSubscriptionResult> {
    const { user, status } = await this.getUser(permanentId)
    let result: UserHasActiveSubscriptionResult = {}

    if (status) {
      result.status = status

      if (status.code && status.code !== 0) {
        this.log.warn(`Could not find user by permanentId: ${permanentId}`)
      }
    }
    if (user) {
      result.isActive = user.subscription && user.subscription.active
    }

    return result
  }

  private getUser (permanentId: string): Promise<GetUserResponse> {
    return new Promise((resolve, reject) => {
      this.client.getUser(
        { permanentId },
        (error, response: GetUserResponse) => {
          if (error) return reject(error)
          resolve(response)
        }
      )
    })
  }
}
