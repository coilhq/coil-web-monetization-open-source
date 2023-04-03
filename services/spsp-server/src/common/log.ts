import { logFactory, Logger } from '@coilhq/metrics'

export function create (namespace: string): Logger {
  return logFactory({name: 'coil-spsp-server-' + namespace})
}
