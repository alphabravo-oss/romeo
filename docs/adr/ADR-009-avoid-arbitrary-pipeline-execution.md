# ADR-009 Avoid Arbitrary Pipeline Execution

Status: Accepted

Romeo will not implement Open WebUI-style arbitrary in-process Python pipelines. Extensibility must use typed tool connectors, approvals, permissions, network policy, and audit.
