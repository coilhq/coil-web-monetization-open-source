// Test the "addSecondsToUsage.lua" script.
//
// This test is not run by `yarn test` -- it requires a Redis server running at
// the default port.
//
// ./node_modules/.bin/jest test/addSecondsToUsage.test.ts

import * as assert from 'assert'

import { Redis, ExtendedRedis } from '../src/services/Redis'

const MAXIMUM_MONTHLY_LIMIT = 4500000000
const LOW_THROUGHPUT_MAX_AGG_INCREASE = 500000000
const TOTAL_MONTHLY_LIMIT =
  MAXIMUM_MONTHLY_LIMIT + LOW_THROUGHPUT_MAX_AGG_INCREASE
const BASE_THROUGHPUT = 100000
const LOW_THROUGHPUT = 186
const KEY = 'usage:alice'

describe('addSecondsToUsage', () => {
  let redis: ExtendedRedis

  beforeEach(async () => {
    redis = new Redis({}).instance()
    await redis.del(KEY)
  })

  it('payment at base rate', async () => {
    assert.deepStrictEqual(
      JSON.parse(await redis.addSecondsToUsage(KEY, 123)),
      {
        low_seconds: 0,
        unspent_seconds: 0,
        base_seconds: 123,
        amount: 123 * BASE_THROUGHPUT
      }
    )
    assert.deepStrictEqual(
      JSON.parse(await redis.addSecondsToUsage(KEY, 456)),
      {
        low_seconds: 0,
        unspent_seconds: 0,
        base_seconds: 456,
        amount: 456 * BASE_THROUGHPUT
      }
    )
    assert.deepStrictEqual(JSON.parse((await redis.get(KEY)) || ''), {
      agg: (123 + 456) * BASE_THROUGHPUT,
      last: 0,
      left: 0,
      total: 0,
      in_flight: 0
    })
  })

  it('payment at low rate', async () => {
    // 123 * 186 = 22878
    await setUsage(MAXIMUM_MONTHLY_LIMIT)
    assert.deepStrictEqual(
      JSON.parse((await redis.addSecondsToUsage(KEY, 123)) || ''),
      {
        low_seconds: 123,
        unspent_seconds: 0,
        base_seconds: 0,
        amount: 123 * LOW_THROUGHPUT
      }
    )
    assert.deepStrictEqual(JSON.parse((await redis.get(KEY)) || ''), {
      agg: MAXIMUM_MONTHLY_LIMIT + 123 * LOW_THROUGHPUT,
      last: 0,
      left: 0,
      total: 0,
      in_flight: 0
    })
  })

  it('payment when maximum is already spent', async () => {
    await setUsage(TOTAL_MONTHLY_LIMIT)
    assert.deepStrictEqual(
      JSON.parse((await redis.addSecondsToUsage(KEY, 123)) || ''),
      {
        low_seconds: 0,
        unspent_seconds: 123,
        base_seconds: 0,
        amount: 0
      }
    )
    assert.deepStrictEqual(JSON.parse((await redis.get(KEY)) || ''), {
      agg: TOTAL_MONTHLY_LIMIT,
      last: 0,
      left: 0,
      total: 0,
      in_flight: 0
    })
  })

  it('payment at mixed rate', async () => {
    await setUsage(MAXIMUM_MONTHLY_LIMIT - 3 * BASE_THROUGHPUT)
    assert.deepStrictEqual(
      JSON.parse((await redis.addSecondsToUsage(KEY, 10)) || ''),
      {
        low_seconds: 7,
        unspent_seconds: 0,
        base_seconds: 3,
        amount: 3 * BASE_THROUGHPUT + 7 * LOW_THROUGHPUT
      }
    )
    assert.deepStrictEqual(JSON.parse((await redis.get(KEY)) || ''), {
      agg: MAXIMUM_MONTHLY_LIMIT + 7 * LOW_THROUGHPUT,
      last: 0,
      left: 0,
      total: 0,
      in_flight: 0
    })
  })

  it('payment truncates at monthly limit', async () => {
    // For some reason Lua appears to truncate this computed float rather than
    // rounding it. So, the seconds spent are:
    //
    //   low: 123.0 nUSD / 186.0(nUSD/s) = 0.6612903225806451 s ≈ 0.66129032258064 s
    //   rem: 88.0 s - 0.66129032258064s = 87.33870967741936 s ≈ 87.338709677419 s
    //
    await setUsage(TOTAL_MONTHLY_LIMIT - 123)
    assert.deepStrictEqual(
      JSON.parse((await redis.addSecondsToUsage(KEY, 88)) || ''),
      {
        low_seconds: 0.66129032258064,
        unspent_seconds: 87.338709677419,
        base_seconds: 0,
        amount: 123
      }
    )
    assert.deepStrictEqual(JSON.parse((await redis.get(KEY)) || ''), {
      agg: TOTAL_MONTHLY_LIMIT,
      last: 0,
      left: 0,
      total: 0,
      in_flight: 0
    })
  })

  async function setUsage (agg: number): Promise<void> {
    await redis.set(
      KEY,
      JSON.stringify({
        agg,
        last: 0,
        left: 0,
        total: 0,
        in_flight: 0
      })
    )
  }
})
