export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rm-page-header">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
