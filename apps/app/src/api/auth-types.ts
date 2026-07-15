export interface LocalMfaFactorSummary {
  id: string
  type: string
  name: string
  status: string
  createdAt: string
  confirmedAt?: string
  disabledAt?: string
  lastUsedAt?: string
}

export interface LocalAuthStatus {
  factors: LocalMfaFactorSummary[]
  hasPassword: boolean
  mfaEnabled: boolean
  role: string
}

export interface TotpEnrollment {
  factor: LocalMfaFactorSummary
  otpauthUri: string
  secret: string
}
