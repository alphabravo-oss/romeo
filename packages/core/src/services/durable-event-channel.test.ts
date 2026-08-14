import { describe, expect, it } from "vitest";

import {
  DURABLE_EVENT_OWNERS,
  durableEventUsesRunSequencer,
  multiplexCompareEvent,
} from "./durable-event-channel";

describe("durable event channels", () => {
  it("reuses the run-event sequencer for compare, export, workflow, and compute", () => {
    for (const owner of DURABLE_EVENT_OWNERS)
      expect(durableEventUsesRunSequencer(owner)).toBe(true);
    expect(
      multiplexCompareEvent(
        {
          ownerKind: "compare",
          ownerId: "compare_1",
          sequence: 3,
          type: "message.delta",
          data: { text: "hi" },
        },
        "leg_a",
      ),
    ).toMatchObject({ legId: "leg_a", sequence: 3 });
  });
});
