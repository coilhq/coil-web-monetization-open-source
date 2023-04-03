import { DecodedUser } from './DecodedUser'

declare global {
  module Express {
    export interface Request {
      user?: DecodedUser
    }
  }
}
