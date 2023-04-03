import { Injector } from 'reduct'
import { Response, NextFunction, RequestHandler } from 'express'
import jwt from 'jsonwebtoken'
import { verifySession } from 'supertokens-node/recipe/session/framework/express'
import { SessionRequest } from 'supertokens-node/framework/express'
import supertokens from 'supertokens-node'
import Session from 'supertokens-node/recipe/session'

import { DecodedUser } from '../types/DecodedUser'

import { Config } from './Config'
import { Log } from './Log'

export class Auth {
  private config: Config
  private log: any

  public constructor (deps: Injector) {
    this.config = deps(Config)
    this.log = deps(Log).log

    supertokens.init({
      framework: 'express',
      supertokens: { connectionURI: this.config.supertokensCore },
      appInfo: {
        appName: this.config.supertokensAppName,
        apiDomain: this.config.frontendUrl,
        apiBasePath: '/api/auth',
        websiteDomain: this.config.frontendUrl
      },
      recipeList: [Session.init()]
    })
  }

  public initializeRequestSession (): RequestHandler {
    return verifySession({ sessionRequired: false })
  }

  public expectAppToken (): RequestHandler {
    return async (
      req: SessionRequest,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      // Guard against spoofing user via incoming headers
      delete req.user
      delete req.headers.user

      // Attempt to read SuperTokens payload
      if (req.session !== undefined) {
        const tokenPayload = req.session.getAccessTokenPayload() as DecodedUser
        if (tokenPayload && tokenPayload.userId) {
          req.user = tokenPayload
          next()
          return
        }
      }

      // Default to legacy JWT authorization
      const authorization = req.header('authorization')

      if (!authorization || !authorization.startsWith('Bearer ')) {
        res.sendStatus(401)
        return
      }

      const token = authorization && authorization.substring('Bearer '.length)

      try {
        const decoded = jwt.verify(token, this.config.appSecret, {
          algorithms: ['HS256']
        }) as DecodedUser
        req['user'] = decoded
      } catch (e) {
        this.log.warn(`error verifying authorization message="${e.message}"`)
        res.sendStatus(401)
        return
      }

      next()
    }
  }
}
