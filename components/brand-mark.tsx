type BrandMarkProps = {
  compact?: boolean;
};

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <div
      aria-hidden="true"
      className={compact ? "brand-mark brand-mark-compact" : "brand-mark"}
    >
      <div className="brand-mark-stem" />
      <div className="brand-mark-diagonal brand-mark-diagonal-top" />
      <div className="brand-mark-diagonal brand-mark-diagonal-bottom" />
      <div className="brand-mark-gate" />
    </div>
  );
}
