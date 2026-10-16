import { Grid2X2, List } from "lucide-react";

export type CollectionView = "list" | "grid";

/** Changes only presentation; the same loaded resources and actions remain available. */
export function CollectionViewToggle({
  value,
  onChange,
  label,
}: {
  value: CollectionView;
  onChange: (value: CollectionView) => void;
  label: string;
}) {
  return (
    <div className="collection-view-toggle" role="group" aria-label={label}>
      <button
        type="button"
        aria-pressed={value === "list"}
        onClick={() => onChange("list")}
      >
        <List size={17} aria-hidden="true" /> Список
      </button>
      <button
        type="button"
        aria-pressed={value === "grid"}
        onClick={() => onChange("grid")}
      >
        <Grid2X2 size={16} aria-hidden="true" /> Плитка
      </button>
    </div>
  );
}
