export interface GetUserResponse {
  status?: GrpcStatus
  user?: OAuthUser
}

export interface UserHasActiveSubscriptionResult {
  status?: GrpcStatus
  isActive?: boolean
}

interface OAuthUser {
  [k: string]: unknown
  email: string
  fullName: string
  permanentId: string
  shortName?: string
  subscription?: any
}

export interface GrpcStatus {
  code: number
  message: string
}
