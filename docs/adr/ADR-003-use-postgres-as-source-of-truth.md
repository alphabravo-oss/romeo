# ADR-003 Use Postgres as Source of Truth

Status: Accepted

Postgres is the durable source of truth for organizations, workspaces, users, agents, chats, runs, messages, tool calls, audit, usage, and knowledge metadata. Milestone 1 may use in-memory repositories for bootstrapping, but database schema remains Postgres-first.
