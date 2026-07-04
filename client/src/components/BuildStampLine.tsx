import { useEffect, useState } from "react";

function readBuildStamp(): string {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="build-stamp"]');
  return meta?.getAttribute("content")?.trim() ?? "";
}

interface BuildStampLineProps {
  className?: string;
}

export function BuildStampLine({ className = "" }: BuildStampLineProps) {
  const [stamp, setStamp] = useState<string>(() => readBuildStamp());

  useEffect(() => {
    if (!stamp) setStamp(readBuildStamp());
  }, [stamp]);

  if (!stamp) return null;

  return (
    <span
      data-testid="public-build-stamp"
      title={`Build ${stamp}`}
      className={`font-mono text-[10px] tracking-wider opacity-60 ${className}`}
    >
      v {stamp}
    </span>
  );
}
