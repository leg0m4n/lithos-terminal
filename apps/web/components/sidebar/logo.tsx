export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 30 40"
        // ~25% above the "Lithos" L cap-height (~22px) for a bit more
        // presence as a badge.
        className="h-[27.72px] w-[20.79px] shrink-0 text-primary"
        aria-hidden="true"
      >
        {/* octagon cut — elongated to match the letter's cap-height */}
        <path
          d="M6 0 L24 0 L30 6 L30 34 L24 40 L6 40 L0 34 L0 6 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <text
          x="15"
          y="20"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="26"
          style={{ fontFamily: "var(--font-gothic)" }}
        >
          L
        </text>
      </svg>
      <div className="flex items-baseline gap-2">
        <span className="font-gothic text-3xl leading-none text-foreground">
          Lithos
        </span>
        <span className="relative -top-[2px] text-xl leading-none font-medium tracking-wide text-muted-foreground">
          Terminal
        </span>
      </div>
    </div>
  );
}
