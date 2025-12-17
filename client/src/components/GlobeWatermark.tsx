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
          r="90"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[#004182] dark:text-blue-400"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="90"
          ry="35"
          stroke="currentColor"
          strokeWidth="1"
          className="text-[#004182] dark:text-blue-400"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="35"
          ry="90"
          stroke="currentColor"
          strokeWidth="1"
          className="text-[#004182] dark:text-blue-400"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="60"
          ry="90"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/70 dark:text-blue-400/70"
          transform="rotate(20 100 100)"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="60"
          ry="90"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/70 dark:text-blue-400/70"
          transform="rotate(-20 100 100)"
        />
        <line
          x1="10"
          y1="100"
          x2="190"
          y2="100"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/50 dark:text-blue-400/50"
        />
        <line
          x1="100"
          y1="10"
          x2="100"
          y2="190"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-[#004182]/50 dark:text-blue-400/50"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="90"
          ry="60"
          stroke="currentColor"
          strokeWidth="0.6"
          className="text-[#004182]/40 dark:text-blue-400/40"
          transform="rotate(45 100 100)"
        />
        <ellipse
          cx="100"
          cy="100"
          rx="90"
          ry="60"
          stroke="currentColor"
          strokeWidth="0.6"
          className="text-[#004182]/40 dark:text-blue-400/40"
          transform="rotate(-45 100 100)"
        />
        <circle
          cx="100"
          cy="100"
          r="60"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="4 4"
          className="text-[#004182]/30 dark:text-blue-400/30"
        />
        <circle
          cx="100"
          cy="100"
          r="30"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="3 3"
          className="text-[#004182]/30 dark:text-blue-400/30"
        />
        <circle
          cx="100"
          cy="40"
          r="3"
          fill="currentColor"
          className="text-[#004182]/60 dark:text-blue-400/60"
        />
        <circle
          cx="100"
          cy="160"
          r="3"
          fill="currentColor"
          className="text-[#004182]/60 dark:text-blue-400/60"
        />
      </svg>
    </div>
  );
}
