import { Injector } from 'reduct'
import { UserHasActiveSubscriptionResult } from '../src/types/Grpc'

export class MockGrpc {
  public constructor (deps: Injector) { }

  async userHasActiveSubscription (permanentId: string): Promise<UserHasActiveSubscriptionResult> {
    return Promise.resolve({isActive: true})
  }
}
