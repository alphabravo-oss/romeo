/**
 * A labelled group of related settings. Use this instead of a bare heading
 * followed by naked form fields so the heading, description, and controls
 * remain one coherent group.
 */
export function SettingsSection(props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}): React.ReactNode {
  return (
    <section className="rm-settings-section" id={props.id}>
      <div className="rm-settings-section__head">
        <div>
          <h3 className="rm-settings-section__title">{props.title}</h3>
          {props.description ? (
            <p className="rm-settings-section__description">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.actions ? <div>{props.actions}</div> : null}
      </div>
      <div className="rm-settings-section__body">{props.children}</div>
    </section>
  );
}
