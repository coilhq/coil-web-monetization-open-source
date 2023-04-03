import nock from 'nock'
import { Rates } from '../src/services/Rates'
import { Config } from '../src/services/Config'
import { MockConfig } from './Mocks'
import reduct from 'reduct'

describe('Rates service', () => {
  let rates: Rates
  beforeEach(() => {
    const injector = reduct()
    injector.setOverride(Config, MockConfig)
    rates = injector(Rates)
  })

  it('should do no conversion to XRP', async () => {
    const result = await rates.convertToAsset('XRP', 1000)
    expect(result).toEqual(1000)
  })

  it('should throw on unknown asset', async () => {
    await expect(rates.convertToAsset('BTC', 1000))
      .rejects
      .toThrow(/unknown asset code/)
  })

  describe('Fetching rates (with barker up)', () => {
    beforeEach(() => {
      nock('http://barker')
        .post('/xrpusd')  
        .reply(200, '0.25')
    })

    afterEach(() => {
      nock.cleanAll()
    })

    it('should convert with fetched rate', async () => {
      const result = await rates.convertToAsset('USD', 1000)
      expect(result).toEqual(250)
    })

    it('should not call barker if recent rate is cached', async () => {
      const privateRates = rates as any
      privateRates.xrpUsdDate = Date.now()
      privateRates.xrpUsdRate = 0.50

      const result = await rates.convertToAsset('USD', 1000)
      expect(result).toEqual(500)
    })

    it('should call barker if rate is expired', async () => {
      const privateRates = rates as any
      privateRates.xrpUsdDate = Date.now() - 2 * privateRates.rateLifetime
      privateRates.xrpUsdRate = 0.50

      const result = await rates.convertToAsset('USD', 1000)
      expect(result).toEqual(250)
    })

    it('should only call barker once for overlapping calls', async () => {
      const promiseA = rates.convertToAsset('USD', 1000)
      const promiseB = rates.convertToAsset('USD', 1000)

      const privateRates = rates as any
      expect(privateRates.xrpRatePromise).toBeTruthy()

      const [ resultA, resultB ] = await Promise.all([
        promiseA,
        promiseB
      ])

      expect(resultA).toEqual(250)
      expect(resultB).toEqual(250)
      expect(privateRates.xrpRatePromise).toBeFalsy()
    })

    it('should fail with serial calls (only one nock)', async () => {
      const result = await rates.convertToAsset('USD', 1000)
      expect(result).toEqual(250)

      const privateRates = rates as any
      delete privateRates.xrpUsdRate

      await expect(rates.convertToAsset('USD', 1000))
        .rejects
        .toThrow(/No match for request/)
    })
  })

  describe('Fetching rates (with barker down)', () => {
    beforeEach(() => {
      nock('http://barker')
        .post('/xrpusd')  
        .reply(500)
    })

    afterEach(() => {
      nock.cleanAll()
    })

    it('should fail to fetch rate', async () => {
      await expect(rates.convertToAsset('USD', 1000))
        .rejects
        .toThrow(/Request failed with status code 500/)
    })
  })
})
