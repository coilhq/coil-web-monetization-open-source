export class Config {
  public logLevel: string

  public constructor () {
    this.logLevel = process.env.LOG_LEVEL || 'info'
  }
}
