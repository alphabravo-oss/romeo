import { z } from "zod";

interface ToolDispatchPayloadEnvironment {
  TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY: string;
  TOOL_DISPATCH_PAYLOAD_STORE_DRIVER: string;
}

export function validateToolDispatchPayloadStore(
  env: ToolDispatchPayloadEnvironment,
  context: z.core.$RefinementCtx,
): void {
  if (
    env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER === "object-store" &&
    env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY.trim().length < 32
  ) {
    context.addIssue({
      code: "custom",
      message:
        "TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY must be at least 32 characters when object-store payload storage is enabled.",
      path: ["TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY"],
      input: env,
    });
  }
}
