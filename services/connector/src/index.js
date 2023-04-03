'use strict'

const Connector = require('ilp-connector')
const os = require('os')

if (process.env.DYNAMIC_CONNECTOR_ACCOUNTS) {
  const podNumber = os.hostname().split('-').slice(-1)[0]
  console.log(`pod number: ${podNumber}`)

  process.env.CONNECTOR_ILP_ADDRESS = process.env.CONNECTOR_ILP_PREFIX + podNumber
  process.env.CONNECTOR_ACCOUNTS = JSON.stringify({
    parent: {
      relation: 'parent',
      plugin: 'ilp-plugin-http',
      assetCode: 'XRP',
      assetScale: 9,
      sendRoutes: false,
      receiveRoutes: false,
      rateLimit: {
        refillCount: 1000000
      },
      options: {
        incoming: {
          port: 80,
          secret: 'connector-child-secret',
          secretToken: 'connector-child-secret-token'
        },
        outgoing: {
          url: 'http://external-ilp-relay-http',
          secretToken: 'connector-parent-secret-token',
          name: podNumber
        }
      }
    },

    spsp: {
      relation: 'child',
      maxPacketAmount: '5000000000',
      plugin: 'ilp-plugin-mini-accounts',
      assetCode: 'XRP',
      assetScale: 9,
      rateLimit: {
        refillCount: 1000000
      },
      options: {
        port: 7768
      }
    },

    client: {
      relation: 'child',
      plugin: '@coilhq/ilp-plugin-flat-stacks',
      assetCode: 'XRP',
      assetScale: 9,
      rateLimit: {
        refillCount: 1000000
      },
      options: {
        secret: process.env.BTP_SECRET,
        allowedOrigins: ['.*'],
        redis: {
          host: process.env.REDIS_HOST
        },
        port: 8090,
        bigqueryDataset: process.env.BIG_QUERY_DATASET,
        bigqueryTable: process.env.BIG_QUERY_TABLE,
        // TODO: Remove this non-partitioned table when ready.
        bigqueryTableNonPartitioned: process.env.BIG_QUERY_TABLE_NON_PARTITIONED,
        stablePriceService: 'http://barker:3021',
        maxPacketAmount: '1000000',
        blacklistLocation: process.env.BLACKLIST_LOCATION
      }
    }
  })
}

const connector = Connector.createApp()

connector.listen()
  .catch(err => {
    const errInfo = (err && typeof err === 'object' && err.stack) ? err.stack : err
    console.error(errInfo)
  })
