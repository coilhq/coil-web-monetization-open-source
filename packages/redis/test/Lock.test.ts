import { v4 as uuidv4 } from 'uuid'

import { Lock, LockError, LOCK_EXPIRY } from '../src/services/Lock'
import { Redis } from '../src/services/Redis'

import { MockRedis } from './mocks/MockRedis'

const MOCK_UUID = 'd77533ff-3774-4600-9a17-99f00d37ee74'
jest.mock('uuid', () => ({ v4: () => MOCK_UUID }))

describe('Lock service', () => {
  let lock: Lock
  let mockRedis: MockRedis

  beforeEach(() => {
    lock = new Lock(new Redis())
    mockRedis = new MockRedis()
    ;(lock as any).redis = mockRedis as any
  })

  it('should set to redis on acquire', async () => {
    await lock.acquire('abc')

    expect(mockRedis._instance.set).toHaveBeenCalledWith(
      'abc',
      MOCK_UUID,
      'nx',
      'px',
      LOCK_EXPIRY
    )
  })

  it('should deleteIfEqual to redis on release', async () => {
    const handle = await lock.acquire('abc')
    handle.release()

    expect(mockRedis._instance.deleteIfEqual).toHaveBeenCalledWith(
      'abc',
      MOCK_UUID
    )
  })

  it('should throw an error on acquire if redis has key', async () => {
    const mockSet = (mockRedis._instance.set = jest.fn(async (_: any) => {
      return false
    }))

    await expect(lock.acquire('abc')).rejects.toBeInstanceOf(LockError)

    expect(mockSet).toHaveBeenCalledWith(
      'abc',
      MOCK_UUID,
      'nx',
      'px',
      LOCK_EXPIRY
    )
  })

  it('should refresh the lock on an interval if not released', async () => {
    jest.useFakeTimers()

    const handle = await lock.acquire('abc')
    expect(mockRedis._instance.set).toHaveBeenCalledWith(
      'abc',
      MOCK_UUID,
      'nx',
      'px',
      LOCK_EXPIRY
    )

    expect(mockRedis._instance.refreshIfEqual).not.toHaveBeenCalled()

    jest.runOnlyPendingTimers()

    expect(mockRedis._instance.refreshIfEqual).toHaveBeenCalledTimes(1)
    expect(mockRedis._instance.refreshIfEqual).toHaveBeenCalledWith(
      'abc',
      MOCK_UUID,
      LOCK_EXPIRY
    )

    handle.release()
    jest.runOnlyPendingTimers()
    expect(mockRedis._instance.refreshIfEqual).toHaveBeenCalledTimes(1)
  })
})
