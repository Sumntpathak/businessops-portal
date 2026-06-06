"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AppLink,
  Button,
  Card,
  CardToolbar,
  EmptyState,
  PageShell,
  StatusBadge,
  Tabs,
  Toast,
  Input,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type ToastType,
} from "@/shared/ui";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utils/cn";
import { badgeBase } from "@/shared/ui/styles";

type DueFilter = "today" | "overdue" | "upcoming" | "";

interface FollowUp {
  id: string;
  leadId: string;
  followUpDate: string;
  message: string;
  status: "Pending" | "Completed" | "Cancelled";
  createdAt: string;
  updatedAt: string;
  leadName: string;
  leadEmail: string;
  leadStatus: string;
}

const TABS: { label: string; value: DueFilter }[] = [
  { label: "Today", value: "today" },
  { label: "Overdue", value: "overdue" },
  { label: "Upcoming", value: "upcoming" },
  { label: "All Records", value: "" },
];

export default function FollowUpsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DueFilter>("today");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  // Search input state
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Pagination states
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Keyboard navigation & shortcuts helper panel states
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [revealShortcuts, setRevealShortcuts] = useState(false);

  // Active popover rescheduling ID
  const [activeRescheduleId, setActiveRescheduleId] = useState<string | null>(null);

  // Date format localization (from local storage)
  const [dateFormat, setDateFormat] = useState("DD-MMM-YYYY");

  // Multi-view states
  const [viewType, setViewType] = useState<"queue" | "table" | "grouped">("queue");
  const [collapsedLeads, setCollapsedLeads] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(10);

  const showToast = (msg: string, type: ToastType = "success") => setToast({ message: msg, type });
  const triggerRefresh = () => setRefreshTrigger((t) => t + 1);

  useEffect(() => {
    // Load preferences asynchronously on mount to prevent SSR hydration warnings
    const savedFormat = localStorage.getItem("pref_date_format") || "DD-MMM-YYYY";
    const savedView = localStorage.getItem("pref_followups_view") as "queue" | "table" | "grouped" | null;
    const savedLimit = localStorage.getItem("pref_followups_limit");

    setTimeout(() => {
      setDateFormat(savedFormat);
      if (savedView === "queue" || savedView === "table" || savedView === "grouped") {
        setViewType(savedView);
      }
      if (savedLimit) {
        setLimit(Number(savedLimit));
      }
    }, 0);
  }, []);

  const handleViewTypeChange = (newView: "queue" | "table" | "grouped") => {
    setViewType(newView);
    localStorage.setItem("pref_followups_view", newView);
    setSelectedIndex(-1);
    setActiveRescheduleId(null);
  };

  const groupedFollowUps = useMemo(() => {
    const groups: Record<string, { leadName: string; leadEmail: string; leadId: string; items: { item: FollowUp; originalIndex: number }[] }> = {};
    followUps.forEach((fu, idx) => {
      if (!groups[fu.leadId]) {
        groups[fu.leadId] = {
          leadName: fu.leadName,
          leadEmail: fu.leadEmail,
          leadId: fu.leadId,
          items: [],
        };
      }
      groups[fu.leadId].items.push({ item: fu, originalIndex: idx });
    });
    return Object.values(groups);
  }, [followUps]);

  const toggleLeadCollapse = (leadId: string) => {
    setCollapsedLeads((prev) => ({
      ...prev,
      [leadId]: !prev[leadId],
    }));
  };

  const getTimelineDotClass = (fu: FollowUp) => {
    if (fu.status !== "Pending") {
      return fu.status === "Completed" ? "border-emerald-500 bg-emerald-50" : "border-gray-300 bg-gray-50";
    }
    const today = new Date().toISOString().split("T")[0];
    if (fu.followUpDate < today) {
      return "border-red-500 bg-red-50";
    }
    if (fu.followUpDate === today) {
      return "border-blue-500 bg-blue-50";
    }
    return "border-gray-400 bg-gray-50";
  };

  // Debounce search query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch followups with server-side pagination and search
  useEffect(() => {
    const controller = new AbortController();

    async function fetchFollowUps() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeTab) params.set("due", activeTab);
        if (activeTab === "overdue" || activeTab === "today") params.set("status", "Pending");
        params.set("page", String(page));
        params.set("limit", String(limit));
        if (debouncedSearch) params.set("search", debouncedSearch);
        
        const res = await fetch(`/api/followups?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (!controller.signal.aborted) {
          setFollowUps(json.data || []);
          setTotalPages(json.pagination?.totalPages || 1);
          setTotalCount(json.pagination?.total || 0);
        }
      } catch {
        if (!controller.signal.aborted) setToast({ message: "Failed to load follow-ups", type: "error" });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchFollowUps();
    return () => controller.abort();
  }, [activeTab, page, debouncedSearch, refreshTrigger, limit]);

  // Keyboard navigation window listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcut hotkeys if user is focusing input boxes or text fields
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      const listLength = followUps.length;

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        if (listLength === 0) return;
        const nextIdx = selectedIndex + 1;
        const idx = nextIdx < listLength ? nextIdx : selectedIndex;
        if (idx !== selectedIndex) {
          setSelectedIndex(idx);
          const nextItem = followUps[idx];
          if (nextItem) {
            setCollapsedLeads((collapsed) => {
              if (collapsed[nextItem.leadId]) {
                return { ...collapsed, [nextItem.leadId]: false };
              }
              return collapsed;
            });
          }
        }
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        if (listLength === 0) return;
        const prevIdx = selectedIndex - 1;
        const idx = prevIdx >= 0 ? prevIdx : 0;
        if (idx !== selectedIndex) {
          setSelectedIndex(idx);
          const prevItem = followUps[idx];
          if (prevItem) {
            setCollapsedLeads((collapsed) => {
              if (collapsed[prevItem.leadId]) {
                return { ...collapsed, [prevItem.leadId]: false };
              }
              return collapsed;
            });
          }
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setRevealShortcuts((r) => !r);
      } else if (selectedIndex >= 0 && selectedIndex < listLength) {
        const item = followUps[selectedIndex];
        
        switch (e.key.toLowerCase()) {
          case "d": // Done (Complete)
            e.preventDefault();
            if (item.status === "Pending") {
              void updateStatus(item.id, "Completed");
            }
            break;
          case "c": // Cancel
            e.preventDefault();
            if (item.status === "Pending") {
              void updateStatus(item.id, "Cancelled");
            }
            break;
          case "r": // Open reschedule popover
            e.preventDefault();
            setActiveRescheduleId((prev) => (prev === item.id ? null : item.id));
            break;
          case "l": // View Lead details page
            e.preventDefault();
            router.push(`/leads/${item.leadId}`);
            break;
          default:
            break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, followUps, router]);

  async function updateStatus(id: string, status: "Completed" | "Cancelled") {
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        showToast(`Marked as ${status}`);
        triggerRefresh();
        setSelectedIndex(-1);
      } else {
        showToast("Update failed", "error");
      }
    } catch {
      showToast("Network error updating status", "error");
    }
  }

  async function rescheduleFollowUp(id: string, newDate: string) {
    try {
      const res = await fetch(`/api/followups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpDate: newDate }),
      });
      if (res.ok) {
        showToast(`Rescheduled to ${formatDateString(newDate, dateFormat)}`);
        triggerRefresh();
        setSelectedIndex(-1);
        setActiveRescheduleId(null);
      } else {
        showToast("Rescheduling failed", "error");
      }
    } catch {
      showToast("Network error rescheduling follow-up", "error");
    }
  }

  // Helper date formatter
  const formatDateString = (dateStr: string, format: string) => {
    const date = new Date(dateStr + "T00:00:00");
    if (isNaN(date.getTime())) return dateStr;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    if (format === "YYYY-MM-DD") {
      return `${yyyy}-${mm}-${dd}`;
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mmm = months[date.getMonth()];
    return `${dd}-${mmm}-${yyyy}`;
  };

  // Helper relative date calculators
  const getRelativeDateLabel = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + "T00:00:00");
    target.setHours(0, 0, 0, 0);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays > 1) return `In ${diffDays} days`;
    return `${Math.abs(diffDays)} days overdue`;
  };

  const getBorderColorClass = (fu: FollowUp) => {
    if (fu.status !== "Pending") {
      return fu.status === "Completed" ? "border-l-emerald-500" : "border-l-gray-300";
    }
    const today = new Date().toISOString().split("T")[0];
    if (fu.followUpDate < today) {
      return "border-l-red-500";
    }
    if (fu.followUpDate === today) {
      return "border-l-blue-500";
    }
    return "border-l-gray-300";
  };

  const getRowBgClass = (fu: FollowUp) => {
    if (fu.status !== "Pending") return "";
    const today = new Date().toISOString().split("T")[0];
    if (fu.followUpDate < today) {
      return "bg-red-50/5 hover:bg-red-50/10";
    }
    if (fu.followUpDate === today) {
      return "bg-blue-50/5 hover:bg-blue-50/10";
    }
    return "";
  };

  const getRelativeBadgeClass = (dateStr: string, status: string) => {
    if (status !== "Pending") return "bg-gray-100 text-gray-500 border-gray-200";
    const today = new Date().toISOString().split("T")[0];
    if (dateStr < today) {
      return "bg-red-50 text-red-700 border-red-100 font-semibold";
    }
    if (dateStr === today) {
      return "bg-blue-50 text-blue-700 border-blue-100 font-semibold";
    }
    return "bg-gray-50 text-gray-500 border-gray-200";
  };

  const getRelativeDateStr = (daysOffset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d.toISOString().split("T")[0];
  };

  return (
    <PageShell
      title="Follow-ups"
      description={`${totalCount} total follow-ups. Track scheduled callbacks, complete client actions, and reschedule follow-up targets.`}
    >
      <Card className="overflow-hidden">
        {/* Sticky Search and Responsive Tabs Header */}
        <div className="sticky top-0 bg-gray-50/95 backdrop-blur-md z-20 border-b border-gray-100">
          <CardToolbar className="items-center justify-between gap-4 border-b-0 bg-transparent">
            <div className="flex-1 max-w-md">
              <Input
                id="followup-search"
                placeholder="Search by lead name, email, or message note..."
                list="followup-search-suggestions"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSelectedIndex(-1);
                }}
                icon={
                  <Icon name="search" className="text-gray-400" />
                }
              />
              <datalist id="followup-search-suggestions">
                {followUps.flatMap((followUp) => [followUp.leadName, followUp.leadEmail, followUp.message].filter(Boolean)).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
            </div>
            <div className="shrink-0 flex flex-wrap items-center gap-3">
              <Tabs
                label="Follow-up due date filters"
                tabs={TABS}
                value={activeTab}
                onChange={(val) => {
                  setActiveTab(val);
                  setSelectedIndex(-1);
                  setActiveRescheduleId(null);
                  setPage(1);
                }}
              />
              <div className="h-6 w-px bg-gray-200/80 hidden sm:block"></div>
              <div className="inline-flex border border-gray-200 bg-gray-50 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleViewTypeChange("queue")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2",
                    viewType === "queue"
                      ? "bg-white text-gray-955 shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  )}
                  title="Queue View"
                >
                  <Icon name="clipboard" />
                  <span>Queue</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewTypeChange("table")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2",
                    viewType === "table"
                      ? "bg-white text-gray-955 shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  )}
                  title="Table View"
                >
                  <Icon name="audit" />
                  <span>Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleViewTypeChange("grouped")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:ring-offset-2",
                    viewType === "grouped"
                      ? "bg-white text-gray-955 shadow-sm"
                      : "text-gray-500 hover:text-gray-800"
                  )}
                  title="Grouped View"
                >
                  <Icon name="users" />
                  <span>Grouped</span>
                </button>
              </div>
            </div>
          </CardToolbar>
        </div>

        <div>
          {loading ? (
            <div className="p-12">
              <EmptyState title="Loading..." description="Fetching scheduled follow-ups." />
            </div>
          ) : followUps.length === 0 ? (
            <div className="p-12">
              <EmptyState
                title="No follow-ups found"
                description={
                  searchQuery
                    ? "No follow-ups match your active search filter query."
                    : activeTab === "today"
                    ? "Nothing due today. Enjoy your day!"
                    : "Nothing in this category."
                }
              />
            </div>
          ) : (
            <>
              {viewType === "queue" && (
                <div className="p-5 space-y-3.5 bg-gray-50/20">
                  {followUps.map((fu, index) => {
                    const isSelected = selectedIndex === index;
                    const leadInitials = fu.leadName
                      ? fu.leadName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()
                      : "LD";

                    return (
                      <div
                        key={fu.id}
                        onClick={() => setSelectedIndex(index)}
                        className={cn(
                          "relative flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-lg border border-gray-200/80 shadow-sm border-l-4 transition-all duration-200 select-none cursor-pointer",
                          getBorderColorClass(fu),
                          getRowBgClass(fu) || "bg-white",
                          isSelected
                            ? "ring-2 ring-blue-500/70 border-blue-300 shadow-md translate-x-1.5"
                            : "hover:shadow-md hover:border-gray-300 hover:translate-x-0.5"
                        )}
                      >
                        {/* Lead and Note Details */}
                        <div className="flex gap-4 items-start w-full sm:w-auto min-w-0 pr-4">
                          {/* Initials Circle */}
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 border border-blue-100 select-none">
                            {leadInitials}
                          </span>
                          
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <AppLink
                                href={`/leads/${fu.leadId}`}
                                className="font-semibold text-sm text-gray-950 hover:text-blue-600 hover:underline truncate"
                              >
                                {fu.leadName || "View Lead Details"}
                              </AppLink>
                              {fu.leadEmail && (
                                <span className="text-xs text-gray-400 truncate">({fu.leadEmail})</span>
                              )}
                            </div>
                            
                            <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed break-words">
                              {fu.message}
                            </p>
                          </div>
                        </div>

                        {/* Actions and Status Metadata */}
                        <div className="flex items-center gap-3 mt-4 sm:mt-0 shrink-0 w-full sm:w-auto justify-between sm:justify-end border-t border-gray-100 sm:border-t-0 pt-3 sm:pt-0">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={fu.status} />
                            <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium border", getRelativeBadgeClass(fu.followUpDate, fu.status))}>
                              {getRelativeDateLabel(fu.followUpDate)}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 relative">
                            {fu.status === "Pending" && (
                              <>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void updateStatus(fu.id, "Completed");
                                  }}
                                  className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs font-semibold shrink-0"
                                >
                                  Done
                                </Button>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveRescheduleId((prev) => (prev === fu.id ? null : fu.id));
                                  }}
                                  className="h-8 text-xs font-semibold shrink-0 flex items-center gap-1"
                                >
                                  <Icon name="calendar" className="size-3.5" />
                                  Reschedule
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void updateStatus(fu.id, "Cancelled");
                                  }}
                                  className="h-8 text-xs font-semibold shrink-0"
                                >
                                  Cancel
                                </Button>
                              </>
                            )}

                            {/* Rescheduling Overlay Popup Menu */}
                            {activeRescheduleId === fu.id && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-0 bottom-10 z-30 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 duration-150"
                              >
                                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2.5 py-1.5 select-none text-left">
                                  Reschedule Options
                                </div>
                                <button
                                  type="button"
                                  onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(1))}
                                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                >
                                  Tomorrow (+1d)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(3))}
                                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                >
                                  In 3 Days (+3d)
                                </button>
                                <button
                                  type="button"
                                  onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(7))}
                                  className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                >
                                  Next Week (+7d)
                                </button>
                                <div className="border-t border-gray-100 my-1"></div>
                                <div className="px-2.5 py-1.5 text-left">
                                  <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">
                                    Custom Date
                                  </label>
                                  <input
                                    type="date"
                                    className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                                    value={fu.followUpDate}
                                    min={new Date().toISOString().split("T")[0]}
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        void rescheduleFollowUp(fu.id, e.target.value);
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {viewType === "table" && (
                <Table wrapperClassName="max-h-[580px] overflow-y-auto relative">
                  <TableHead>
                    <tr>
                      <TableHeaderCell className="w-12 border-l-4 border-transparent">#</TableHeaderCell>
                      <TableHeaderCell className="w-1/4">Lead</TableHeaderCell>
                      <TableHeaderCell className="w-2/5">Task Description</TableHeaderCell>
                      <TableHeaderCell className="w-36">Due Date</TableHeaderCell>
                      <TableHeaderCell className="w-28">Status</TableHeaderCell>
                      <TableHeaderCell className="text-right pr-6">Actions</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {followUps.map((fu, index) => {
                      const isSelected = selectedIndex === index;
                      const leadInitials = fu.leadName
                        ? fu.leadName
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)
                            .toUpperCase()
                        : "LD";

                      return (
                        <TableRow
                          key={fu.id}
                          onClick={() => setSelectedIndex(index)}
                          className={cn(
                            "group cursor-pointer select-none transition-all duration-150",
                            getRowBgClass(fu),
                            isSelected ? "bg-blue-50/50 hover:bg-blue-50/70 ring-2 ring-blue-500/30" : ""
                          )}
                        >
                          <TableCell className={cn("w-12 font-medium text-gray-400 border-l-4", getBorderColorClass(fu))}>
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 border border-blue-100 select-none">
                                {leadInitials}
                              </span>
                              <div className="min-w-0">
                                <AppLink
                                  href={`/leads/${fu.leadId}`}
                                  className="font-semibold text-sm text-gray-950 hover:text-blue-600 hover:underline truncate block"
                                >
                                  {fu.leadName || "Lead Details"}
                                </AppLink>
                                {fu.leadEmail && (
                                  <span className="mt-0.5 text-xs text-gray-400 truncate block select-text" onClick={(e) => e.stopPropagation()}>
                                    {fu.leadEmail}
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-md">
                              <p className="text-sm text-gray-600 line-clamp-2 leading-relaxed whitespace-pre-line select-text" onClick={(e) => e.stopPropagation()}>
                                {fu.message}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className={cn(badgeBase, getRelativeBadgeClass(fu.followUpDate, fu.status))}>
                              {getRelativeDateLabel(fu.followUpDate)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={fu.status} />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()} className="text-right align-middle pr-6">
                            <div className="flex items-center justify-end gap-1.5 relative">
                              {fu.status === "Pending" && (
                                <>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => void updateStatus(fu.id, "Completed")}
                                    className="bg-emerald-600 hover:bg-emerald-700 h-7 text-[11px] px-2.5 font-semibold shrink-0"
                                  >
                                    Done
                                  </Button>
                                  <div className="relative">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => setActiveRescheduleId((prev) => (prev === fu.id ? null : fu.id))}
                                      className="h-7 text-[11px] px-2.5 font-semibold shrink-0 flex items-center gap-1"
                                    >
                                      <Icon name="calendar" className="size-3" />
                                      Reschedule
                                    </Button>

                                    {activeRescheduleId === fu.id && (
                                      <div className="absolute right-0 top-8 z-30 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 duration-150">
                                        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2.5 py-1.5 text-left select-none">
                                          Reschedule Options
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(1))}
                                          className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                        >
                                          Tomorrow (+1d)
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(3))}
                                          className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                        >
                                          In 3 Days (+3d)
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => rescheduleFollowUp(fu.id, getRelativeDateStr(7))}
                                          className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                        >
                                          Next Week (+7d)
                                        </button>
                                        <div className="border-t border-gray-100 my-1"></div>
                                        <div className="px-2.5 py-1.5 text-left">
                                          <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">
                                            Custom Date
                                          </label>
                                          <input
                                            type="date"
                                            className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                                            value={fu.followUpDate}
                                            min={new Date().toISOString().split("T")[0]}
                                            onChange={(e) => {
                                              if (e.target.value) {
                                                void rescheduleFollowUp(fu.id, e.target.value);
                                              }
                                            }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => void updateStatus(fu.id, "Cancelled")}
                                    className="h-7 text-[11px] px-2.5 font-semibold shrink-0"
                                  >
                                    Cancel
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {viewType === "grouped" && (
                <div className="p-5 space-y-6 bg-gray-50/20">
                  {groupedFollowUps.map((group) => {
                    const isCollapsed = !!collapsedLeads[group.leadId];
                    const leadInitials = group.leadName
                      ? group.leadName
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()
                      : "LD";

                    return (
                      <div key={group.leadId} className="bg-white border border-gray-200/80 rounded-lg shadow-sm overflow-hidden transition-all duration-200">
                        {/* Lead Group Header */}
                        <div
                          onClick={() => toggleLeadCollapse(group.leadId)}
                          className="flex items-center justify-between p-4 bg-gray-50/70 border-b border-gray-100 hover:bg-gray-100 cursor-pointer select-none"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 border border-blue-100 select-none">
                              {leadInitials}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <AppLink
                                  href={`/leads/${group.leadId}`}
                                  className="font-semibold text-sm text-gray-955 hover:text-blue-600 hover:underline truncate"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {group.leadName}
                                </AppLink>
                                {group.leadEmail && (
                                  <span className="text-xs text-gray-400 truncate" onClick={(e) => e.stopPropagation()}>
                                    ({group.leadEmail})
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-400 font-semibold tracking-wider uppercase mt-0.5">
                                Lead Group Profile
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-100">
                              {group.items.length} {group.items.length === 1 ? "callback" : "callbacks"}
                            </span>
                            <button
                              type="button"
                              className="text-gray-400 hover:text-gray-600 p-0.5 transition-transform duration-200"
                              style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
                            >
                              <Icon name="chevronDown" />
                            </button>
                          </div>
                        </div>

                        {/* Group Timeline Body */}
                        {!isCollapsed && (
                          <div className="p-5 bg-white">
                            <div className="relative border-l-2 border-gray-100 ml-4 pl-5 space-y-5">
                              {group.items.map(({ item, originalIndex }) => {
                                const isSelected = selectedIndex === originalIndex;

                                return (
                                  <div
                                    key={item.id}
                                    onClick={() => setSelectedIndex(originalIndex)}
                                    className={cn(
                                      "relative p-4 rounded-lg border border-gray-200/80 shadow-sm transition-all duration-200 cursor-pointer select-none",
                                      getRowBgClass(item) || "bg-white",
                                      isSelected
                                        ? "ring-2 ring-blue-500/70 border-blue-300 shadow-md translate-x-1"
                                        : "hover:shadow-md hover:border-gray-300 hover:translate-x-0.5"
                                    )}
                                  >
                                    {/* Timeline dot */}
                                    <span className={cn("absolute -left-[28px] top-6 size-3.5 rounded-full border-2 bg-white z-10 transition-colors duration-200", getTimelineDotClass(item))} />

                                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                      {/* Message details */}
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed break-words select-text" onClick={(e) => e.stopPropagation()}>
                                          {item.message}
                                        </p>
                                      </div>

                                      {/* Metadata and Actions */}
                                      <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-between sm:justify-end border-t border-gray-55 sm:border-t-0 pt-3 sm:pt-0">
                                        <div className="flex items-center gap-2">
                                          <StatusBadge status={item.status} />
                                          <span className={cn(badgeBase, getRelativeBadgeClass(item.followUpDate, item.status))}>
                                            {getRelativeDateLabel(item.followUpDate)}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1.5 relative">
                                          {item.status === "Pending" && (
                                            <>
                                              <Button
                                                variant="primary"
                                                size="sm"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void updateStatus(item.id, "Completed");
                                                }}
                                                className="bg-emerald-600 hover:bg-emerald-700 h-8 text-xs font-semibold shrink-0"
                                              >
                                                Done
                                              </Button>
                                              <div className="relative">
                                                <Button
                                                  variant="secondary"
                                                  size="sm"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setActiveRescheduleId((prev) => (prev === item.id ? null : item.id));
                                                  }}
                                                  className="h-8 text-xs font-semibold shrink-0 flex items-center gap-1"
                                                >
                                                  <Icon name="calendar" className="size-3.5" />
                                                  Reschedule
                                                </Button>

                                                {activeRescheduleId === item.id && (
                                                  <div
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="absolute right-0 bottom-10 z-30 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5 animate-in fade-in slide-in-from-bottom-2 duration-150"
                                                  >
                                                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2.5 py-1.5 text-left select-none">
                                                      Reschedule Options
                                                    </div>
                                                    <button
                                                      type="button"
                                                      onClick={() => rescheduleFollowUp(item.id, getRelativeDateStr(1))}
                                                      className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                                    >
                                                      Tomorrow (+1d)
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => rescheduleFollowUp(item.id, getRelativeDateStr(3))}
                                                      className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                                    >
                                                      In 3 Days (+3d)
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() => rescheduleFollowUp(item.id, getRelativeDateStr(7))}
                                                      className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100/70 font-medium transition"
                                                    >
                                                      Next Week (+7d)
                                                    </button>
                                                    <div className="border-t border-gray-100 my-1"></div>
                                                    <div className="px-2.5 py-1.5 text-left">
                                                      <label className="block text-[9px] uppercase font-bold text-gray-400 tracking-wider mb-1">
                                                        Custom Date
                                                      </label>
                                                      <input
                                                        type="date"
                                                        className="w-full text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                                                        value={item.followUpDate}
                                                        min={new Date().toISOString().split("T")[0]}
                                                        onChange={(e) => {
                                                          if (e.target.value) {
                                                            void rescheduleFollowUp(item.id, e.target.value);
                                                          }
                                                        }}
                                                      />
                                                    </div>
                                                  </div>
                                                )}
                                              </div>
                                              <Button
                                                variant="danger"
                                                size="sm"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void updateStatus(item.id, "Cancelled");
                                                }}
                                                className="h-8 text-xs font-semibold shrink-0"
                                              >
                                                Cancel
                                              </Button>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                limit={limit}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  localStorage.setItem("pref_followups_limit", String(newLimit));
                  setPage(1);
                }}
              />
            </>
          )}
        </div>
      </Card>

      {/* Floating Keyboard Shortcuts Cheat Sheet Helper */}
      {revealShortcuts ? (
        <div className="fixed bottom-6 right-6 z-40 max-w-sm rounded-xl border border-gray-200/90 bg-white/95 backdrop-blur-md p-4 shadow-xl ring-1 ring-black/5 animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2">
            <span className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
              <Icon name="keyboard" className="text-blue-600" />
              Keyboard Quick Commands (Vim / Vim Mode)
            </span>
            <button onClick={() => setRevealShortcuts(false)} className="text-gray-400 hover:text-gray-600 text-xs font-medium cursor-pointer">
              Hide
            </button>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-500">Navigate queue list</span>
              <span className="flex items-center gap-1 shrink-0">
                <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">J</kbd>
                <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">K</kbd>
                <span className="text-gray-400 text-[10px]">or</span>
                <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">↑</kbd>
                <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">↓</kbd>
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-550">Mark selected callback Completed</span>
              <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">D</kbd>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-550">Cancel selected callback</span>
              <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">C</kbd>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-550">Reschedule (open calendar menu)</span>
              <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">R</kbd>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-gray-550">Navigate to Lead details view</span>
              <kbd className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-mono shadow-sm font-semibold">L</kbd>
            </div>
            <div className="flex justify-between items-center border-t border-gray-100 pt-1.5 mt-1.5 text-[9px] text-gray-400 italic">
              <span>Press `?` key anywhere to toggle helper pane</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRevealShortcuts(true)}
          className="fixed bottom-6 right-6 z-40 size-9 rounded-full bg-white hover:bg-gray-50 text-gray-500 hover:text-gray-800 flex items-center justify-center border border-gray-200 shadow-md ring-1 ring-black/5 transition-all hover:scale-105"
          title="Show Keyboard Hotkeys"
        >
          <span className="text-sm font-mono font-bold">?</span>
        </button>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageShell>
  );
}
