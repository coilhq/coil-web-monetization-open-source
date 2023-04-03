import * as http from 'http'

import { Injector } from 'reduct'
import express, { Application, NextFunction, Request, Response } from 'express'
import bodyParser from 'body-parser'
import jwt from 'jsonwebtoken'
import { Redis, RedisClient } from '@coilhq/redis'
import * as metrics from '@coilhq/metrics'

import { Config } from './Config'
import { Auth } from './Auth'
import { ChallengeClient } from './ChallengeClient'
import { Grpc } from './Grpc'
import { Log } from './Log'

// $4.5 USD / month
const MAXIMUM_MONTHLY_LIMIT = 1e9 * 4.5
const BASE_THROUGHPUT = 100000
const LOW_THROUGHPUT = 186
const LOW_THROUGHPUT_MAX_AGG_INCREASE = 5e8
const REDEEMED_TOKEN_PREFIX = 'redeemed:'
const TWO_MONTHS_MS = 2 * 31 * 24 * 60 * 60 * 1000
export const USAGE_KEY = (id: string) => `usage:${id}`

export class App {
  private config: Config
  private auth: Auth
  private grpc: Grpc
  private baseCbs: ChallengeClient
  private lowCbs: ChallengeClient
  private log: any

  private redis: RedisClient

  private signerApp: Application
  private redeemerApp: Application

  private signerServer?: http.Server
  private redeemerServer?: http.Server

  public constructor (deps: Injector) {
    this.config = deps(Config)
    this.auth = deps(Auth)
    this.baseCbs = new ChallengeClient({
      log: deps(Log).log,
      host: this.config.baseCbsHost,
      port: this.config.baseCbsPort
    })
    this.lowCbs = new ChallengeClient({
      log: deps(Log).log,
      host: this.config.lowCbsHost,
      port: this.config.lowCbsPort
    })
    this.log = deps(Log).log
    this.grpc = deps(Grpc)

    const redis = new Redis({ redisUri: this.config.redisUri })
    this.redis = redis.instance()

    this.signerApp = express()
    this.redeemerApp = express()

    this.signerApp.use(
      metrics.express.logFactory({ name: 'redeemer-signerApp' })
    )
    this.redeemerApp.use(
      metrics.express.logFactory({ name: 'redeemer-reedemerApp' })
    )

    this.signerApp.use(bodyParser.json())
    this.redeemerApp.use(bodyParser.json())

    // Ingress health checks.
    this.signerApp.get('/', healthCheck)
    this.redeemerApp.get('/', healthCheck)
    // Pod readiness probes.
    this.signerApp.get('/healthz', healthCheck)
    this.redeemerApp.get('/healthz', healthCheck)

    this.redeemerApp.get(
      '/redeemer/commitments',
      (_req: Request, res: Response): void => {
        const commitments = this.currentCommitments()
        res.send(commitments)
      }
    )

    this.signerApp.post(
      '/issuer/issue',
      this.auth.initializeRequestSession(),
      this.auth.expectAppToken(),
      validateBlindTokenRequestWrapper,
      async (req: Request, res: Response): Promise<void> => {
        if (!req.user || !req.user.userId || !req.user.userPermanentId) {
          this.log.warn(`user missing props. user=${req.user}`)

          res.status(401).send({
            unsubscribed: true,
            message: 'you must be subscribed'
          })
          return
        }

        let tokenCount
        try {
          const request = parseBase64JSON(req.body.bl_sig_req)
          tokenCount = request['contents'].length
        } catch (err) {
          res.status(400).send({ message: 'invalid request format' })
          this.log.warn(`invalid /issue body err="${err.message}"`)
          return
        }
        const { userId } = req.user

        // Use grpc to determine whether the user has an active subscription.
        // This is used over `req.user.agg`. `agg` isn't always correct -- a
        // user may have an out-of-date token shortly after subscribing that
        // incorrectly attests that they have no subscription.
        let { isActive, status } = await this.grpc.userHasActiveSubscription(
          req.user.userPermanentId
        )

        if (typeof isActive === 'undefined') {
          let message = 'could not find user'
          if (status && status.message) {
            message = status.message
          }
          res.status(404).send({ message })
          return
        } else if (!isActive) {
          res.status(400).send({ message: 'no active subscription' })
          this.log.warn(
            `unsubscribed users cannot be issued tokens userId=${req.user.userId}`
          )
          return
        }

        let totalValue = throughputToTokenValue(BASE_THROUGHPUT) * tokenCount
        let cbsClient = this.baseCbs
        let maxAggAmount = MAXIMUM_MONTHLY_LIMIT
        const result = await this.redis.addToUsage(
          USAGE_KEY(userId),
          totalValue,
          maxAggAmount
        )
        if (!result) {
          totalValue = throughputToTokenValue(LOW_THROUGHPUT) * tokenCount
          cbsClient = this.lowCbs
          maxAggAmount += LOW_THROUGHPUT_MAX_AGG_INCREASE
          const result = await this.redis.addToUsage(
            USAGE_KEY(userId),
            totalValue,
            maxAggAmount
          )
          if (!result) {
            res.status(422).send({
              exceeded: true,
              message: 'exceeds maximum usage'
            })
            return
          }
        }

        try {
          const start = Date.now()
          const response = await cbsClient.request(
            Buffer.from(JSON.stringify(req.body))
          )
          // If any error occurs during Issue (including a malformed request),
          // the challenge-bypass-server:
          //   1. Logs the error.
          //   2. Closes the socket.
          // That's it. It doesn't write any response back.
          //
          // See: https://github.com/privacypass/challenge-bypass-server/blob/82c7063c5ff3d9fd7087dd36825c1a2620230bf7/server/main.go#L111-L114
          const isError = response.length === 0
          if (isError) {
            // Refund on error.
            await this.redis.addToUsage(
              USAGE_KEY(userId),
              -totalValue,
              maxAggAmount
            )
            res.status(400).send({ message: 'could not issue tokens' })
            return
          }
          res.send(Buffer.from(response.toString(), 'base64'))
        } catch (err) {
          // Refund on error.
          await this.redis.addToUsage(
            USAGE_KEY(userId),
            -totalValue,
            maxAggAmount
          )
          this.log.warn(
            `error issuing tokens count=%d message="${tokenCount}" ${err.message}`
          )
          res.status(422).send({ message: err.message })
        }
      }
    )

    this.redeemerApp.post(
      '/redeemer/redeem',
      validateBlindTokenRequestWrapper,
      async (req: Request, res: Response): Promise<void> => {
        let redeemToken
        try {
          redeemToken = getRedeemRequestToken(req.body)
        } catch (err) {
          res.status(400).send({ message: 'invalid body' })
          return
        }
        const cacheKey = REDEEMED_TOKEN_PREFIX + redeemToken

        // challenge-bypass-server prevents tokens from being double-spent --
        // if a token is spent a second time, it will return an error.
        // To circumvent this "feature", the redeemer service caches redeemed tokens
        // to allow them to be reused.
        const throughputStr = await this.redis.get(cacheKey)
        let throughput = throughputStr && +throughputStr
        if (throughput) {
          this.log.info(`redeem cached token throughput=${throughput}`)
        } else {
          const redeemReq = Buffer.from(JSON.stringify(req.body))
          const start = Date.now()
          throughput = await this.getRedeemedTokenThroughput(redeemReq)
          this.log.info(
            `redeem token throughput=${throughput} time=${Date.now() - start}`
          )
          if (!throughput) {
            this.log.warn(
              `redeem failed; invalid token time=${Date.now() - start}`
            )
            res.status(400).send({ message: 'redeem failed; invalid token' })
            return
          }
          await this.redis.set(cacheKey, throughput, 'px', TWO_MONTHS_MS)
        }

        // Note: `redeemToken` is 44-characters when base64-encoded.
        const userId = `anon:${redeemToken}`
        const agg = throughputToTokenValue(throughput)
        const usage = await this.redis.get(USAGE_KEY(userId))
        const remaining = agg - ((usage && +JSON.parse(usage).agg) || 0)
        res.send({
          remaining,
          throughput,
          token: jwt.sign(
            {
              userId,
              throughput,
              agg,
              currency: 'USD',
              scale: 9,
              // TODO: should this be month of expiry?
              anon: true
            },
            this.config.btpSecret,
            {
              // Slightly over 1 minute to allow for some leeway before the
              // connection starts. That way, the BTP token won't need to be
              // re-fetched if the client is a couple seconds slow to start.
              expiresIn: 70 * 60
            }
          )
        })
      }
    )
  }

  public init (): void {
    this.signerServer = this.signerApp.listen(
      this.config.signerPort,
      (): void => {
        this.log.info(`signer listening on ${this.config.signerPort}`)
      }
    )

    this.redeemerServer = this.redeemerApp.listen(
      this.config.redeemerPort,
      (): void => {
        this.log.info(`redeemer listening on ${this.config.redeemerPort}`)
      }
    )
  }

  public close (): void {
    if (this.signerServer) this.signerServer.close()
    if (this.redeemerServer) this.redeemerServer.close()
    this.redis.quit()
  }

  // Returns the redeemed token's throughput.
  private async getRedeemedTokenThroughput (req: Buffer): Promise<number> {
    const isBaseToken = await this.baseCbs.redeem(req, 'base')
    if (isBaseToken) {
      return BASE_THROUGHPUT
    }
    const isLowToken = await this.lowCbs.redeem(req, 'low')
    if (isLowToken) {
      return LOW_THROUGHPUT
    }
    return 0
  }

  private currentCommitments (): object[] {
    const now = new Date()
    const commitmentKey =
      now.getUTCFullYear().toString() +
      '-' +
      (1 + now.getUTCMonth()).toString().padStart(2, '0')
    const commitments = [
      this.config.baseCommitments[commitmentKey],
      this.config.lowCommitments[commitmentKey]
    ].filter(commitment => {
      if (!commitment) {
        this.log.warn(`missing commitment key=${commitmentKey}`)
      }
      return !!commitment
    })
    return commitments
  }
}

function healthCheck (req, res) {
  res.send('OK')
}

function throughputToTokenValue (throughput: number): number {
  return throughput * 60
}

function validateBlindTokenRequestWrapper (
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.body || !req.body.bl_sig_req) {
    // The bodyParser middleware doesn't actually verify that a body is present.
    res.status(400).send({ message: 'invalid request body' })
    return
  }
  next()
}

function getRedeemRequestToken (body: object): string {
  const blindTokenRequest = parseBase64JSON(body['bl_sig_req'])
  const token = blindTokenRequest['contents'][0]
  return token
}

function parseBase64JSON (data: string): object {
  return JSON.parse(Buffer.from(data, 'base64').toString())
}
