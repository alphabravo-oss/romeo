# Knowledge upload declaration limit

`POST /knowledge-bases/{knowledgeBaseId}/uploads` accepts declared objects up to
25,000,000 bytes. The limit is enforced before storage reservation so oversized
inputs cannot create unbounded object-store or extraction work.

This is an accepted pre-1.0 security restriction. Clients must reject or split
larger content before requesting an upload. A future limit reduction requires a
new compatibility-ledger decision; a larger limit is additive.
