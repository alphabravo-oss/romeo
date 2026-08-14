# ADR-0005: Knowledge ACL enforcement semantics

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-12, EP-13

## Context

Retrieval can disclose content even when the final answer is filtered. Connectors vary
in document ACL fidelity, group expansion, freshness, delegated-query support, and
deletion semantics. Ingest-time workspace access alone is insufficient.

## Decision

1. Tenant, organization, workspace, source, document, and current subject authorization
   are mandatory before candidate content can influence ranking, context, citations,
   caches, evals, or output.
2. Every connector declares ACL capability, principal mapping, group/nesting behavior,
   freshness, deletion, and failure semantics. Unsupported ACL-bearing sources are not
   eligible for enterprise retrieval.
3. Romeo uses one explicit enforcement mode per source: synchronized ACL filtering,
   provider-delegated query under the user identity, or a documented public/shared
   corpus policy. Modes cannot silently fall back to a less restrictive one.
4. Deny, revoke, deletion, disabled user, unmapped principal, stale ACL beyond policy,
   and resolver failure fail closed for protected sources.
5. Authorization is re-evaluated at retrieval and protected content fetch. Stored
   citations and caches contain stable references and safe metadata, not an access grant.
6. Chunk/document/source lineage and ACL version are preserved. Derived embeddings,
   summaries, caches, and eval fixtures inherit source restrictions and purge semantics.
7. Retrieval events and audits expose counts, modes, versions, and safe reason codes—no
   query, chunk, document title/path, principal list, or protected content.
8. Tenant predicates are structural and mandatory in every repository query; application
   post-filtering is defense in depth, not the primary boundary.

## Consequences

- Index freshness and ACL freshness have separate SLOs.
- Search relevance may degrade or retrieval may be disabled during entitlement outages;
  stale protected results are not preferable to a safe denial.
- Admin visibility into connector health does not grant document read access.

## Validation

- Direct, owner, group, nested-group, guest, revoked, disabled, unmapped, cross-org, and
  permission-changed-during-run matrices in memory and live PostgreSQL.
- Candidate generation, reranking, context assembly, citations, cache, export, and eval
  negative tests prove denied text is never observed.
- Connector conformance and production synthetic allow/deny probes use non-sensitive data.
- ACL sync lag, unresolved principal, stale source, deletion backlog, and denied retrieval
  alerts are exercised.

## Reconsider when

A connector offers a stronger verifiable enforcement mechanism. Moving modes requires
parallel evidence and cannot create a permissive migration interval.
