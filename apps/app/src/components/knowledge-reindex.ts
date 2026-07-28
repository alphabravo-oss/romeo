// Pure guard for the knowledge reindex action. Extracted because the original
// handler sourced its payload from the Add-Source dialog's form state, which
// meant reindexing row A shipped row B's text -- the row identity and the
// content identity had drifted apart with nothing asserting they matched.

export interface ReindexRequest {
  /** The row whose Reindex button was pressed. */
  sourceId: string;
  /** The id the payload was actually built from. */
  payloadSourceId: string | undefined;
}

/** True only when the payload provably describes the row that was clicked. */
export function isReindexPayloadCoherent(request: ReindexRequest): boolean {
  return (
    request.payloadSourceId !== undefined &&
    request.payloadSourceId === request.sourceId
  );
}
