import * as crypto from 'crypto'

export class Config {
  public port: number
  public metricsPort: number
  public dbPath?: string
  public projectId?: string
  public datasetName: string
  public tableName: string
  public APIToken?: string
  public redisHost?: string
  public coilAPI?: string
  public devMode?: boolean
  public connectionTagKey: string
  public grpcServer: string
  public barkerHost?: string
  public statsConfig: object

  constructor () {
    const devMode = Boolean(process.env.DEV)

    if (!devMode && (!process.env.BIG_QUERY_DATASET || !process.env.BIG_QUERY_TABLE)) {
      throw new Error('BIG_QUERY_DATASET and BIG_QUERY_TABLE are required')
    }
    this.port = +(process.env.PORT || 8080)
    this.metricsPort = +(process.env.METRICS_PORT || 8081)
    this.dbPath = process.env.DB_PATH
    this.projectId = process.env.GCLOUD_PROJECT
    this.datasetName = process.env.BIG_QUERY_DATASET || ''
    this.tableName = process.env.BIG_QUERY_TABLE || ''
    this.APIToken = process.env.TOKEN
    this.redisHost = process.env.REDIS_HOST
    this.coilAPI = process.env.COIL_API
    this.devMode = devMode
    this.connectionTagKey = process.env.CONNECTION_TAG_KEY || crypto.randomBytes(32).toString('base64')
    this.grpcServer = process.env.GRPC_SERVER || 'localhost:6000'
    this.barkerHost = process.env.BARKER_HOST
    this.statsConfig = {
      port: 8125
    }
  }
}
