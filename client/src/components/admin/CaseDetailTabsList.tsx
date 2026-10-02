import { TabsList, TabsTrigger } from "@/components/ui/tabs";

// The exact set of tabs surfaced inside the admin case-detail dialog.
// Extracted from AdminDashboard.tsx so tests can mount the same trigger
// row that production renders without having to render the entire 9k-line
// dashboard. Adding / removing / renaming a tab here flows to both the
// production dialog and the test in one place.
export const CASE_DETAIL_TABS = [
  { value: "overview",       label: "Case Details" },
  { value: "workflow",       label: "Workflow" },
  { value: "documents",      label: "Documents" },
  { value: "communications", label: "Conversation" },
  { value: "letters",        label: "Letters" },
  { value: "paid",           label: "Payments & Receipts" },
  { value: "audit",          label: "Activity" },
] as const;

export type CaseDetailTabValue = (typeof CASE_DETAIL_TABS)[number]["value"];

export function CaseDetailTabsList({
  hiddenTabs = [],
}: {
  hiddenTabs?: string[];
}) {
  const visible = CASE_DETAIL_TABS.filter((t) => !hiddenTabs.includes(t.value));
  return (
    <TabsList className="flex w-full justify-start gap-1 overflow-x-auto bg-slate-950/70 border border-slate-800 p-1 rounded-xl">
      {visible.map((t) => (
        <TabsTrigger
          key={t.value}
          value={t.value}
          className="shrink-0 whitespace-nowrap px-3 py-2 text-xs sm:text-sm rounded-lg text-slate-400 data-[state=active]:bg-slate-800 data-[state=active]:text-white data-[state=active]:shadow-sm"
          data-testid={`case-tab-${t.value}`}
        >
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
