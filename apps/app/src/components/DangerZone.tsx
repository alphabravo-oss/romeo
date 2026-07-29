/**
 * Separates destructive actions from routine settings so they never compete
 * visually with ordinary save and navigation actions.
 */
export function DangerZone(props: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="rm-danger-zone">
      <div>
        <h3 className="rm-danger-zone__title">{props.title}</h3>
        {props.description ? (
          <p className="rm-danger-zone__description">{props.description}</p>
        ) : null}
      </div>
      <div>{props.children}</div>
    </section>
  );
}
