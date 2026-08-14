export const DURABLE_EVENT_OWNERS = [
  "run",
  "workflow",
  "export",
  "compare",
  "compute",
  "image_job",
] as const;
export type DurableEventOwner = (typeof DURABLE_EVENT_OWNERS)[number];

export interface DurableEventEnvelope {
  ownerKind: DurableEventOwner;
  ownerId: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  legId?: string;
}

export function durableEventUsesRunSequencer(
  ownerKind: DurableEventOwner,
): true {
  void ownerKind;
  return true;
}

export function multiplexCompareEvent(
  event: Omit<DurableEventEnvelope, "legId">,
  legId: string,
): DurableEventEnvelope {
  return { ...event, legId };
}
