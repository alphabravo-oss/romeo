import { Button } from "@romeo/ui";

/**
 * Appears only when the form is dirty and carries exactly two actions. A Save
 * button parked permanently at the bottom of a settings page gives the admin
 * no signal about whether anything is pending; this does.
 */
export function SettingsSaveBar(props: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel: string;
  discardLabel: string;
  dirtyLabel: string;
}): React.ReactNode {
  if (!props.dirty) return null;
  return (
    <div className="rm-save-bar" role="region" aria-label={props.dirtyLabel}>
      <span className="rm-save-bar__label">{props.dirtyLabel}</span>
      <div className="rm-save-bar__actions">
        <Button
          disabled={props.saving}
          onClick={props.onDiscard}
          type="button"
          variant="ghost"
        >
          {props.discardLabel}
        </Button>
        <Button
          onClick={props.onSave}
          pending={props.saving}
          type="button"
          variant="primary"
        >
          {props.saveLabel}
        </Button>
      </div>
    </div>
  );
}
