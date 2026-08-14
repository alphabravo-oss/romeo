import { resolveAvatarImageSource } from "@romeo/contracts/avatar-url";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import { useMemo, useState } from "react";

import type { Agent } from "../features/managed-models";

export function ManagedModelAvatar({
  agent,
  className = "",
  size = 40,
}: {
  agent: Pick<Agent, "avatarUrl" | "icon" | "name">;
  className?: string;
  size?: number;
}) {
  const [failedSource, setFailedSource] = useState<string>();
  const source = useMemo(
    () => resolveAvatarImageSource(agent.avatarUrl),
    [agent.avatarUrl],
  );
  const showImage = source !== undefined && source.src !== failedSource;

  return (
    <span
      aria-hidden="true"
      className={`rm-managed-model-avatar ${className}`}
      style={{ height: size, width: size }}
    >
      {showImage ? (
        <img
          alt=""
          {...(source.kind === "remote"
            ? {
                crossOrigin: "anonymous" as const,
                referrerPolicy: "no-referrer" as const,
              }
            : {})}
          height={size}
          onError={() => setFailedSource(source.src)}
          src={source.src}
          width={size}
        />
      ) : agent.icon?.trim() ? (
        <span className="rm-managed-model-avatar__icon">
          {agent.icon.trim()}
        </span>
      ) : (
        <Bot aria-hidden="true" size={Math.max(16, Math.round(size * 0.48))} />
      )}
    </span>
  );
}
