export interface WorkLease {
  attempt: number;
  expiresAt: string;
  fencingToken: number;
  owner: string;
  token: string;
}

export interface ClaimWorkLeaseInput {
  leaseExpiresAt: string;
  leaseOwner: string;
  leaseToken: string;
  now: string;
}

export interface RenewWorkLeaseInput extends ClaimWorkLeaseInput {
  fencingToken: number;
}

export interface FinishWorkLeaseInput {
  fencingToken: number;
  leaseOwner: string;
  leaseToken: string;
  now: string;
}
