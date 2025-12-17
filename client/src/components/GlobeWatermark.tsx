export function GlobeWatermark() {
  return (
    <div className="globe-watermark animate-slow-spin" aria-hidden="true">
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <circle
          cx="100"
          cy="100"
          r="92"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-[#004182] dark:text-blue-400"
        />
        <circle
          cx="100"
          cy="100"
          r="88"
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-[#004182]/40 dark:text-blue-400/40"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="92"
          ry="38"
          stroke="currentColor"
          strokeWidth="1.8"
          className="text-[#004182] dark:text-blue-400"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="38"
          ry="92"
          stroke="currentColor"
          strokeWidth="1.8"
          className="text-[#004182] dark:text-blue-400"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="65"
          ry="92"
          stroke="currentColor"
          strokeWidth="1.2"
          className="text-[#004182]/80 dark:text-blue-400/80"
          transform="rotate(25 100 100)"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="65"
          ry="92"
          stroke="currentColor"
          strokeWidth="1.2"
          className="text-[#004182]/80 dark:text-blue-400/80"
          transform="rotate(-25 100 100)"
        />
        <line
          x1="8"
          y1="100"
          x2="192"
          y2="100"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[#004182]/70 dark:text-blue-400/70"
        />
        <line
          x1="100"
          y1="8"
          x2="100"
          y2="192"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[#004182]/70 dark:text-blue-400/70"
        />
        <ellipse
          cx="100"
          cy="60"
          rx="75"
          ry="8"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/50 dark:text-blue-400/50"
        />
        <ellipse
          cx="100"
          cy="140"
          rx="75"
          ry="8"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/50 dark:text-blue-400/50"
        />
        <circle
          cx="100"
          cy="100"
          r="70"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeDasharray="6 3"
          className="text-[#004182]/35 dark:text-blue-400/35"
        />
        <circle
          cx="100"
          cy="100"
          r="45"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="4 2"
          className="text-[#004182]/30 dark:text-blue-400/30"
        />
        <circle
          cx="100"
          cy="8"
          r="4"
          fill="currentColor"
          className="text-[#004182]/80 dark:text-blue-400/80"
        />
        <circle
          cx="100"
          cy="192"
          r="4"
          fill="currentColor"
          className="text-[#004182]/80 dark:text-blue-400/80"
        />
        <circle
          cx="8"
          cy="100"
          r="3"
          fill="currentColor"
          className="text-[#004182]/60 dark:text-blue-400/60"
        />
        <circle
          cx="192"
          cy="100"
          r="3"
          fill="currentColor"
          className="text-[#004182]/60 dark:text-blue-400/60"
        />
      </svg>
    </div>
  );
}
