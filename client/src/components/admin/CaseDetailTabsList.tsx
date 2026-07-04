import { TabsList, TabsTrigger } from "@/components/ui/tabs";

// The exact set of tabs surfaced inside the admin case-detail dialog.
// Extracted from AdminDashboard.tsx so tests can mount the same trigger
// row that production renders without having to render the entire 9k-line
// dashboard. Adding / removing / renaming a tab here flows to both the
// production dialog and the test in one place.
export const CASE_DETAIL_TABS = [
  { value: "overview",       label: "Overview" },
  { value: "phrase-key",     label: "Phrase Key" },
  { value: "workflow",       label: "Workflow" },
  { value: "documents",      label: "Documents" },
  { value: "communications", label: "Communications" },
  { value: "audit",          label: "Audit" },
  { value: "paid",           label: "Paid" },
] as const;

export type CaseDetailTabValue = (typeof CASE_DETAIL_TABS)[number]["value"];

const COL_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

export function CaseDetailTabsList({
  hiddenTabs = [],
}: {
  hiddenTabs?: string[];
}) {
  const visible = CASE_DETAIL_TABS.filter((t) => !hiddenTabs.includes(t.value));
  const colClass = COL_CLASS[visible.length] ?? "grid-cols-6";
  return (
    <TabsList className={`grid w-full ${colClass} bg-slate-900 border border-slate-800`}>
      {visible.map((t) => (
        <TabsTrigger
          key={t.value}
          value={t.value}
          className="data-[state=active]:bg-slate-800"
          data-testid={`case-tab-${t.value}`}
        >
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
