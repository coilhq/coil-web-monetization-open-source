// NOTE: These tests require a redis-server and a challenge-bypass-server running
// on the default ports:
//   $ redis-server
// and
//   $ go run cmd/server/main.go --key testdata/p256-key.pem --comm testdata/test-p256-commitment
//

import * as assert from 'assert'
import * as fs from 'fs'
import * as http from 'http'
import jwt from 'jsonwebtoken'
import reduct from 'reduct'
import { USAGE_KEY, App } from '../src/services/App'
import { Config } from '../src/services/Config'
import { Grpc } from '../src/services/Grpc'
import { MockGrpc } from './MockGrpc'

const BL_SIG_REQ = fs.readFileSync(__dirname + '/fixtures/bl_sig_req')

interface BlindTokenRequest {
  type: 'Issue' | 'Redeem',
  contents: string[],
}

class BlindTokenRequestWrapper {
  // A base64-encoded BlindTokenRequest.
  bl_sig_req: string
  constructor (req: BlindTokenRequest) {
    this.bl_sig_req = Buffer.from(JSON.stringify(req)).toString('base64')
  }
}

describe('App', function () {
  let app: App
  let config: Config
  let signerUri: string
  let redeemerUri: string
  let authToken: string
  const userId = 'bob'

  beforeEach(async function () {
    const injector = reduct()
    injector.setOverride(Grpc, MockGrpc)
    app = injector(App)
    config = injector(Config)
    signerUri = `http://127.0.0.1:${config.signerPort}/issuer/issue`
    redeemerUri = `http://127.0.0.1:${config.redeemerPort}/redeemer/redeem`
    app.init()

    const token = {
      iat: 1580757269915,
      userId,
      userPermanentId: userId,
      agg: '2000000000'
    }
    authToken = jwt.sign(token, config.appSecret)

    // Make sure a bucket exists.
    await app['redis'].addToUsage(USAGE_KEY(userId), 0, +token.agg)
  })

  afterEach(function () {
    app.close()
  })

  describe('POST /issue', function () {
    it('issues tokens', async function () {
      const balanceBefore = await getCurrentBalance()
      const res = await postRequest(signerUri, BL_SIG_REQ)
      assert.equal(res.statusCode, 200)

      const bodyBuffer = await collect(res)
      const issuedTokenResponse = JSON.parse(bodyBuffer.toString())

      assert.equal(issuedTokenResponse.version, '1.0')
      assert.equal(issuedTokenResponse.sigs.length, 10)
      assert.ok(issuedTokenResponse.sigs.every((sig) => Buffer.from(sig, 'base64')))
      assert.ok(Buffer.from(issuedTokenResponse.proof, 'base64'))

      const balanceAfter = await getCurrentBalance()
      assert.equal(+balanceAfter, +balanceBefore + 10 * 60 * 100000)
    })

    it('requires that the request is authenticated', async function () {
      authToken = 'nope'
      const res = await postRequest(signerUri, BL_SIG_REQ)
      assert.equal(res.statusCode, 401)
    })

    it('forwards an error from the challenge-bypass-server', async function () {
      const balanceBefore = await getCurrentBalance()

      const res = await postRequest(signerUri, Buffer.from(JSON.stringify({
        "bl_sig_req": Buffer.from(JSON.stringify({
          type: "InvalidType",
          contents: []
        })).toString('base64')
      })))
      assert.equal(res.statusCode, 400)
      const bodyBuffer = await collect(res)
      const body = JSON.parse(bodyBuffer.toString())
      assert.equal(body.message, 'could not issue tokens')

      const balanceAfter = await getCurrentBalance()
      assert.equal(balanceBefore, balanceAfter)
    })
  })

  describe('POST /redeem', function () {

/*
    beforeEach(async function () {
      const res = await postRequest(signerUri, BL_SIG_REQ)
      const body = JSON.parse((await collect(res)).toString())
    })
*/

    it('fails with ErrTooFewRedemptionArguments when no contents are sent', async function () {
      const blindTokenRequestWrapper = new BlindTokenRequestWrapper({
        type: 'Redeem',
        contents: []
      })
      const res = await postRequest(
        redeemerUri,
        Buffer.from(JSON.stringify(blindTokenRequestWrapper))
      )
      assert.equal(res.statusCode, 400)
    })
  })

  async function getCurrentBalance (): Promise<number> {
    const result = await app['redis'].get(USAGE_KEY(userId))
    if (!result) throw new Error('user not found')
    return JSON.parse(result).agg
  }

  function postRequest (uri: string, body: Buffer): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const request = http.request(uri, { method: 'POST' }, resolve)
      if (uri === signerUri) {
        request.setHeader('Authorization', `Bearer ${authToken}`)
      }
      request.setHeader('Content-Type', 'application/json')
      request.once('error', reject)
      request.end(body)
    })
  }
})

function collect (res: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  res.on('data', (chunk) => chunks.push(chunk))
  return new Promise((resolve, reject) => {
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  })
}
