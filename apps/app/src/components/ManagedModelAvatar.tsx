import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import { useState } from "react";

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
  const [imageFailed, setImageFailed] = useState(false);
  const avatarUrl = agent.avatarUrl?.trim();

  return (
    <span
      aria-hidden="true"
      className={`rm-managed-model-avatar ${className}`}
      style={{ height: size, width: size }}
    >
      {avatarUrl && !imageFailed ? (
        <img
          alt=""
          height={size}
          onError={() => setImageFailed(true)}
          src={avatarUrl}
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
