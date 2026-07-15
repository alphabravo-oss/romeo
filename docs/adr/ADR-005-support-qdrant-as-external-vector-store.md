# ADR-005 Support Qdrant as External Vector Store

Status: Accepted

Qdrant is the first external vector-store target for larger deployments. Qdrant point ids must reference Postgres chunk ids so Postgres remains source of truth.
