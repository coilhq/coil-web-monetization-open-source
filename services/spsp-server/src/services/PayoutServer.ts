import * as crypto from 'crypto'

import bodyParser from 'koa-bodyparser'
import Boom from 'boom'
import KoaRouter from 'koa-router'
import { Server } from 'ilp-protocol-stream'
import * as ILDCP from 'ilp-protocol-ildcp'
import { Injector } from 'reduct'
import Koa from 'koa'

import { create } from '../common/log'

import { Config } from './Config'
import { CoilContent } from './CoilContent'
import { DonationQueue } from './donationQueue'
import { ConnectionTag } from './ConnectionTag'

const log = create('serverIndex')
const plugin = require('ilp-plugin')()

interface PaymentInfo {
  service: string
  user: string
  requestId: string
  postId?: string
  creatorId?: string
  meta?: object
}

export class PayoutServer {
  private config: Config
  private donationQueue: DonationQueue
  private coilContent: CoilContent
  private connectionTag: ConnectionTag

  constructor (deps: Injector) {
    this.config = deps(Config)
    this.donationQueue = deps(DonationQueue)
    this.coilContent = deps(CoilContent)
    this.connectionTag = deps(ConnectionTag)
  }

  async handleMoney (
    {
      service,
      user,
      amount,
      requestId,
      postId,
      creatorId,
      meta
    }: PaymentInfo & { amount: string }
  ): Promise<void> {
    const amountValue = Number(amount)
    switch (service) {
      case 'coil-content':
        await this.coilContent.handleMoney({ user, amount: amountValue, requestId, postId, creatorId })
        break
      case 'donate':
        // donate gets this metadata passed in, but other services don't use it
        await this.donationQueue.payBucket(user, amountValue, meta)
        break
    }
  }

  async getReceiverMetadata (ctx: Koa.Context): Promise<object | void> {
    const { service, user } = ctx.params
    switch (service) {
      // right now donate is the only one with metadata
      case 'donate':
        return this.donationQueue.getReceiverMetadata(user)
    }
  }

  async validateQueryService (ctx: Koa.Context): Promise<void> {
    try {
      await this.handleQuery(ctx)
    } catch (e) {
      if (Boom.isBoom(e)) {
        ctx.throw(e.output.statusCode, e.message)
      } else {
        throw e
      }
    }
  }

  async handleQuery (
    ctx: Koa.Context
  ): Promise<void> {
    const { service, user } = ctx.params
    const { query } = ctx.request
    switch (service) {
      case 'coil-content':
        const requestId = ctx.get('Web-Monetization-Id')
        if (query && requestId) {
          const {
            creatorId,
            postId
          } = query
          log.info(`Paying out to Coil creator requestId=${requestId}, postId=${postId}, creatorId=${creatorId}`)

          if (!creatorId && !postId) {
            throw Boom.badRequest(`Invalid values set for creatorId=${creatorId} and postId=${postId} for requestId=${requestId}`)
          }
          await this.coilContent.handleQuery({
            requestId,
            // TODO: Remove type casts
            creatorId: creatorId as string,
            postId: postId as string
          })
        } else {
          throw Boom.badRequest(`Incorrect query parameters ${JSON.stringify(query)} or web monetization ${requestId} for user=${user} and service=${service}`)
        }
        break

      case 'donate':
        await this.donationQueue.verifyUser(user)
        break

      default:
        throw Boom.notFound('unknown service. service=' + service)
    }
  }

  async run () {
    const router = new KoaRouter()
    const app = new Koa()
    log.info('connecting to moneyd')
    await plugin.connect()
    const info = await ILDCP.fetch(plugin.sendData.bind(plugin))
    this.coilContent.setAssetScale(info.assetScale)
    const server = new Server({
      plugin,
      serverSecret: crypto.randomBytes(32),
      exchangeRate: 1.0
    })

    router.post('/payout/:service/:user', async ctx => {
      // This is so we can update our bucket when we manually donate using PayPal. Add for twitch as well?
      const service = ctx.params.service
      const user = ctx.params.user
      if (!ctx.request.header.authorization || ctx.request.header.authorization !== `Bearer ${this.config.APIToken}`) {
        const error = 'Unauthenticated post request'
        log.error(error)
        ctx.throw(403, error)
      }
      try {
        await this.handleQuery(ctx)
        switch (service) {
          case 'donate':
            const amount = Number(ctx.request.body.amount)
            await this.donationQueue.payOut(user, amount)
            ctx.body = {
              success: true
            }
            break
          default:
            throw Boom.notFound('unknown service, service=' + service)
        }
      } catch (e) {
        if (Boom.isBoom(e)) {
          ctx.throw(e.output.statusCode, e.message)
        } else {
          throw e
        }
      }
    })

    router.get('/', async ctx => {
      ctx.body = {
        healthy: true
      }
    })

    router.get('/healthz', async ctx => {
      ctx.body = 'ok'
    })

    // serve preflight CORS requests.
    // preflight CORS is being triggered because our script sends custom headers
    router.options('/:service/:user', async ctx => {
      ctx.body = ''
      ctx.status = 204
      ctx.set('Access-Control-Allow-Origin', '*')
      ctx.set('Access-Control-Allow-Methods', 'GET')
      ctx.set('Access-Control-Allow-Headers', 'web-monetization-id')
      ctx.set('Access-Control-Max-Age', '86400')
    })

    router.get('/:service/:user', async ctx => {
      const queryString = ctx.request.url.split('?')[1]
      if (queryString && queryString.length > 256) {
        ctx.throw(400, 'query string is too long; max 256 chars')
      }

      if (ctx.get('Accept').indexOf('application/spsp4+json') !== -1) {
        const requestId = ctx.get('Web-Monetization-Id')
        const { query } = ctx.request
        const paymentInfo: PaymentInfo = {
          service: ctx.params.service,
          user: ctx.params.user,
          requestId,
          // TODO: Remove type casts
          postId: query.postId as string,
          creatorId: query.creatorId as string
        }

        // see if we have any metadata about this receiver
        const meta = await this.getReceiverMetadata(ctx)
        if (meta) {
          paymentInfo.meta = meta
        } else {
          // if no metadata we fall back to asking if the receiver exists
          await this.validateQueryService(ctx)
        }

        const encoded = this.connectionTag.encode(JSON.stringify(paymentInfo))
        const details = server.generateAddressAndSecret(encoded)
        ctx.body = {
          destination_account: details.destinationAccount,
          shared_secret: details.sharedSecret.toString('base64')
        }
        ctx.set('Content-Type', 'application/spsp4+json')
        ctx.set('Access-Control-Allow-Origin', '*')
      } else {
        ctx.throw(406, 'Incorrect Accept data type. Should be application/spsp4+json')
      }
    })

    router.use('/coil-api/*', async (ctx, next) => {
      // TODO: Remove non-null assertion
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const secret = Buffer.from(ctx.request.header.authorization!, 'utf8')
      const compareToken = Buffer.from(`Bearer ${this.config.APIToken}`, 'utf8')

      if (!secret || !crypto.timingSafeEqual(compareToken, secret)) {
        const error = 'Unauthenticated post request'
        log.error(error)
        ctx.throw(403, error)
      }
      return next()
    })

    router.post('/coil-api/verify-payment', async ctx => {
      const { requestId, postId, creatorId } = ctx.request.body

      const paymentVerified = await this.coilContent.hasReceivedMoney({ requestId, postId, creatorId })
      // set payment pointer
      ctx.body = {
        paymentVerified
      }
    })

    server.on('connection', conn => {
      const {
        service,
        user,
        requestId,
        postId,
        creatorId,
        meta
      } = JSON.parse(this.connectionTag.decode(conn.connectionTag))

      log.debug(`got stream connection. service=${service} user=${user}`)
      conn.on('stream', stream => {
        stream.setReceiveMax(String(2 ** 56))
        stream.on('money', amount => {
          log.debug(`received money. amount=${amount} service=${service} user=${user} requestId=${requestId} postId=${postId} creatorId=${creatorId}`)

          try {
            this.handleMoney({
              service,
              user,
              amount,
              requestId,
              postId,
              creatorId,
              meta
            })
          } catch (e) {
            log.error(
              {
                error: e,
                service,
                user,
                requestId
              },
              'error handling money'
            )
            conn.destroy(e)
          }

        })
        stream.on('error', (err) => {
          log.warn({err}, 'payout stream error')
        })
      })

      conn.on('error', (err) => {
        log.warn({err}, 'payout connection error')
      })
    })

    log.info('listening on stream server')
    await server.listen()

    app
      .use(bodyParser())
      .use(router.routes())
      .use(router.allowedMethods())
      .listen(this.config.port)
    log.info(`http server listening. port={this.config.port}`)
  }
}
