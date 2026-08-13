export function Logo() {
  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="0 0 30 40"
        className="h-[30px] w-[22.5px] shrink-0 text-primary"
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
          y="21"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="32"
          style={{ fontFamily: "var(--font-gothic)" }}
        >
          L
        </text>
      </svg>
      <div className="flex items-end gap-2">
        <span className="font-gothic text-3xl leading-none text-foreground">
          Lithos
        </span>
        <span className="text-xl leading-none font-medium tracking-wide text-muted-foreground">
          Terminal
        </span>
      </div>
    </div>
  );
}
