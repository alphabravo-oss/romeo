# ADR-008 Use OpenAPI for Public API

Status: Accepted

Romeo exposes `/api/v1` through OpenAPI-described routes. The web app may use internal calls, but external clients must not reverse-engineer web implementation details.
