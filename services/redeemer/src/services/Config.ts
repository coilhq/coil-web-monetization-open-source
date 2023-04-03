export class Config {
  public signerPort = process.env.SIGNER_PORT || 8080
  public redeemerPort = process.env.REDEEMER_PORT || 8081
  public metricsPort = +(process.env.METRICS_PORT || 8087)
  public dev =
  process.env.DEVELOPMENT === 'true' || process.env.NODE_ENV === 'development'

  public grpcServer = process.env.GRPC_HOST

  // These should be set to the same app and btp secrets used in the API
  public appSecret = process.env.APP_SECRET || 'shh-its-an-app-secret'
  public btpSecret = process.env.BTP_SECRET || 'shh-its-a-btp-secret'
  public redisUri = process.env.REDIS_URI || 'redis://localhost:6379'

  public baseCbsHost = process.env.BASE_CBS_HOST || '127.0.0.1'
  public lowCbsHost = process.env.LOW_CBS_HOST || '127.0.0.1'
  public baseCbsPort = +(process.env.BASE_CBS_PORT || 2416)
  public lowCbsPort = +(process.env.LOW_CBS_PORT || 2416)

  public supertokensCore =
  process.env.SUPERTOKENS_CORE || 'http://localhost:3567'

  public supertokensAppName = process.env.SUPERTOKENS_APP_NAME || 'Coil'
  public frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000'

  public baseCommitments = parseCommitments(
    process.env.BASE_THROUGHPUT_COMMITMENTS || '{}'
  )

  public lowCommitments = parseCommitments(
    process.env.LOW_THROUGHPUT_COMMITMENTS || '{}'
  )
}

interface Commitment {
  G: string
  H: string
}

function parseCommitments (str: string): { [key: string]: Commitment } {
  const commitmentStrings = JSON.parse(str)
  const commitments = {}
  for (const key in commitmentStrings) {
    commitments[key] = JSON.parse(commitmentStrings[key])
  }
  return commitments
}
