CREATE INDEX IF NOT EXISTS audit_logs_support_request_created_idx
  ON audit_logs (org_id, created_at, id)
  WHERE action = 'support.impersonation.request.create'
    AND resource_type = 'support_impersonation_request';

CREATE INDEX IF NOT EXISTS audit_logs_support_decision_idx
  ON audit_logs (org_id, ((metadata ->> 'approvalRequestId')), created_at, id)
  WHERE action IN (
    'support.impersonation.request.approve',
    'support.impersonation.request.reject'
  );

CREATE INDEX IF NOT EXISTS audit_logs_support_session_created_idx
  ON audit_logs (org_id, created_at, id)
  WHERE action = 'support.impersonation.create'
    AND resource_type = 'session';
