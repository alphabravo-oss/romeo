import { Button, Input } from "@romeo/ui";
import { resolveAvatarImageSource } from "@romeo/contracts/avatar-url";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus.mjs";
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import {
  AVATAR_ACCEPTED_TYPES,
  fileToAvatarDataUrl,
  type AvatarRejection,
} from "./avatar-image";

/**
 * Pick a custom model's picture: drop a file on it, click to browse, or paste
 * an image from the clipboard.
 *
 * All three routes end in the same downscaled `data:` URI, so a caller only
 * ever deals with one string. A remote URL is still supported behind a
 * disclosure, because pointing at a corporate asset host is a real use — it is
 * just no longer the *only* way in, which is what made this field awkward.
 */
export function AvatarPicker({
  disabled = false,
  hint,
  label,
  labels,
  onChange,
  preview,
  value,
}: {
  disabled?: boolean;
  hint?: ReactNode;
  label: string;
  labels: {
    browse: string;
    dropHere: string;
    remove: string;
    tooLarge: string;
    unsupported: string;
    invalidUrl: string;
    urlLabel: string;
    useUrl: string;
  };
  onChange: (value: string) => void;
  /** Rendered preview of the current value — the caller owns the avatar mark. */
  preview: ReactNode;
  value: string;
}): ReactNode {
  const inputId = useId();
  const urlId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [urlInvalid, setUrlInvalid] = useState(false);

  async function accept(file: File | undefined) {
    if (!file || disabled) return;
    setError(undefined);
    setUrlInvalid(false);
    setBusy(true);
    try {
      onChange(await fileToAvatarDataUrl(file));
    } catch (caught) {
      const rejection = caught as AvatarRejection;
      setError(
        rejection?.reason === "size" ? labels.tooLarge : labels.unsupported,
      );
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void accept(event.dataTransfer.files[0]);
  }

  return (
    <div className="cs-avatar">
      <span className="cs-avatar__label">{label}</span>
      {/* Drag handlers live on the wrapper; the label inside does only what a
          label does — clicking it opens the file dialog natively, with no
          handler and no lost keyboard access. Drag-and-drop is a pointer-only
          convenience, and the Choose button below is the accessible path. */}
      <div
        className={`cs-avatar__drop${dragging ? " is-dragging" : ""}${
          disabled ? " is-disabled" : ""
        }`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDrop={onDrop}
        onPaste={(event) => {
          const file = event.clipboardData?.files?.[0];
          if (file) {
            void accept(file);
          }
        }}
      >
        <label className="cs-avatar__target" htmlFor={inputId}>
          <span className="cs-avatar__preview">{preview}</span>
          <span className="cs-avatar__copy">
            <span className="cs-avatar__prompt">
              <ImagePlus aria-hidden size={14} />
              {busy ? "…" : labels.dropHere}
            </span>
            {hint === undefined ? null : (
              <span className="cs-avatar__hint">{hint}</span>
            )}
          </span>
        </label>
        <Input
          accept={AVATAR_ACCEPTED_TYPES.join(",")}
          className="cs-avatar__input"
          disabled={disabled}
          id={inputId}
          onChange={(event) => {
            void accept(event.currentTarget.files?.[0]);
            // Reset so choosing the same file twice still fires a change.
            event.currentTarget.value = "";
          }}
          ref={inputRef}
          type="file"
        />
      </div>

      <div className="cs-avatar__actions">
        <Button
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
        >
          {labels.browse}
        </Button>
        {value ? (
          <Button
            disabled={disabled}
            onClick={() => {
              setError(undefined);
              setUrlInvalid(false);
              onChange("");
            }}
            size="sm"
            type="button"
            variant="ghost"
          >
            {labels.remove}
          </Button>
        ) : null}
        <Button
          className="cs-avatar__urltoggle"
          disabled={disabled}
          onClick={() => setShowUrl((open) => !open)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {labels.useUrl}
        </Button>
      </div>

      {showUrl ? (
        <label className="cs-avatar__url" htmlFor={urlId}>
          <span>{labels.urlLabel}</span>
          <Input
            autoComplete="url"
            className="rm-ui-control"
            disabled={disabled}
            id={urlId}
            name="avatarUrl"
            aria-describedby={error && urlInvalid ? errorId : undefined}
            aria-invalid={urlInvalid}
            onBlur={(event) => {
              const candidate = event.currentTarget.value.trim();
              if (candidate.length === 0) {
                setError(undefined);
                setUrlInvalid(false);
                return;
              }
              const source = resolveAvatarImageSource(candidate);
              if (source?.kind === "remote") {
                setError(undefined);
                setUrlInvalid(false);
                onChange(source.src);
                return;
              }
              setError(labels.invalidUrl);
              setUrlInvalid(true);
            }}
            onChange={(event) => {
              setError(undefined);
              setUrlInvalid(false);
              onChange(event.currentTarget.value);
            }}
            placeholder="https://…"
            type="url"
            value={value.startsWith("data:") ? "" : value}
          />
        </label>
      ) : null}

      {error ? (
        <p className="cs-avatar__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
