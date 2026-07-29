export interface ClipboardEnvironment {
  legacyWrite?: (value: string) => boolean;
  modernWrite?: (value: string) => Promise<void>;
}

export async function writeTextToClipboard(
  value: string,
  environment = browserClipboardEnvironment(),
): Promise<boolean> {
  if (environment === undefined) return false;

  if (environment.modernWrite !== undefined) {
    try {
      await environment.modernWrite(value);
      return true;
    } catch {
      // The Clipboard API can be unavailable outside a secure context or when
      // the browser rejects a permission prompt. The DOM fallback below is
      // synchronous, scoped to the user gesture, and immediately cleaned up.
    }
  }

  try {
    return environment.legacyWrite?.(value) ?? false;
  } catch {
    return false;
  }
}

function browserClipboardEnvironment(): ClipboardEnvironment | undefined {
  if (typeof document === "undefined") return undefined;

  return {
    ...(typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
      ? { modernWrite: (value: string) => navigator.clipboard.writeText(value) }
      : {}),
    legacyWrite: (value) => {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.readOnly = true;
      textarea.setAttribute("aria-hidden", "true");
      textarea.style.position = "fixed";
      textarea.style.inset = "0 auto auto -9999px";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try {
        return document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    },
  };
}
