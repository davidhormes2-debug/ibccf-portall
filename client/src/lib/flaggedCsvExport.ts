export interface FlaggedCsvThread {
  id: number;
  authorHandle: string;
  content: string;
  flagReason: string | null;
  createdAt: string;
}

export interface FlaggedCsvPost {
  id: number;
  authorHandle: string;
  content: string;
  flagReason: string | null;
  createdAt: string;
}

export function buildFlaggedCsvLines(
  flaggedThreads: FlaggedCsvThread[],
  flaggedPosts: FlaggedCsvPost[],
): string[] {
  const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const header = ["id", "type", "author", "content_preview", "flag_reason", "date_flagged"];
  const threadRows = flaggedThreads.map((t) => [
    t.id,
    "thread",
    t.authorHandle,
    t.content.slice(0, 200),
    t.flagReason ?? "",
    t.createdAt,
  ]);
  const postRows = flaggedPosts.map((p) => [
    p.id,
    "reply",
    p.authorHandle,
    p.content.slice(0, 200),
    p.flagReason ?? "",
    p.createdAt,
  ]);
  const allRows = [...threadRows, ...postRows];
  return [
    header.map(escapeCsv).join(","),
    ...allRows.map((row) => row.map((cell) => escapeCsv(String(cell))).join(",")),
  ];
}
