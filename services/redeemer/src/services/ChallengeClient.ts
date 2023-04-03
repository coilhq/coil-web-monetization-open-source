import * as net from 'net'

const CONNECT_TIMEOUT = 1000
const RESPONSE_TIMEOUT = 1000

export class ChallengeClient {
  private log: any
  private host: string
  private port: number

  constructor ({ log, host, port }: { log: any, host: string, port: number }) {
    this.log = log
    this.host = host
    this.port = port
  }

  // Returns whether or not the Redeem succeeded. The returned promise never rejects.
  redeem (requestBody: Buffer, throughput: 'base' | 'low'): Promise<boolean> {
    const start = Date.now()
    return this.request(requestBody)
      .then(resBuf => {
        const res = resBuf.toString()
        if (res === 'success') return true
        this.log.warn(`redeem remote error response="${res}"`)
        return false
      })
      .catch(err => {
        this.log.warn(`redeem connection error err="${err.message}"`)
        return false
      })
  }

  async request (requestBody: Buffer): Promise<Buffer> {
    const socket = await createConnection({
      timeout: RESPONSE_TIMEOUT,
      port: this.port,
      host: this.host
    })

    return new Promise(
      (resolve, reject): void => {
        const chunks: Buffer[] = []

        socket.once(
          'error',
          (err): void => {
            reject(err)
          }
        )

        socket.on(
          'data',
          (data): void => {
            chunks.push(data)
          }
        )

        socket.on(
          'end',
          (): void => {
            resolve(Buffer.concat(chunks))
          }
        )
        socket.write(requestBody)
      }
    )
  }
}

function createConnection (options: net.NetConnectOpts): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(options)

    const timer = setTimeout(() => {
      socket.removeAllListeners('error')
      socket.removeAllListeners('connect')
      socket.destroy()
      reject(new Error('connect timed out'))
    }, CONNECT_TIMEOUT)

    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeListener('error', reject)
      resolve(socket)
    })

    socket.once('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}
