/** The Evocast mark: four bars of a voice, the tallest in the accent. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.3, background: "var(--label)", display: "inline-grid", placeItems: "center", flex: "none" }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 18 18">
        {[3, 7, 11, 15].map((x, i) => (
          <rect key={x} x={x - 1} y={[6, 2, 4, 7][i]} width="2" height={[6, 14, 10, 4][i]} rx="1" fill={i === 1 ? "var(--accent)" : "var(--bg)"} />
        ))}
      </svg>
    </span>
  );
}
