import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit3, Trash2, AlertTriangle, Star, HelpCircle, BarChart3, Mail, MessageSquare, RefreshCw, Download, FileWarning, Pencil, Check, X } from "lucide-react";
import { ApiRequestError, apiRequest } from "@/lib/adminApiRequest";

interface ScamAlert {
  id: number;
  title: string;
  description: string;
  severity: string;
  platformName?: string;
  isActive: boolean;
  createdAt: string;
}

interface Testimonial {
  id: number;
  name: string;
  location?: string;
  content: string;
  rating: number;
  isApproved: boolean;
  isFeatured: boolean;
  createdAt: string;
}

interface FaqItem {
  id: number;
  question: string;
  answer: string;
  displayOrder: number;
  isActive: boolean;
}

interface SiteStatistic {
  id: number;
  key: string;
  label: string;
  value: string;
  displayOrder: number;
}

interface NewsletterSubscriber {
  id: number;
  email: string;
  isActive: boolean;
  subscribedAt: string;
  unsubscribedAt?: string | null;
}

interface ContactSubmission {
  id: number;
  name: string;
  email: string;
  subject?: string;
  message: string;
  status: string;
  createdAt: string;
}

interface PublicComplaint {
  id: number;
  name: string;
  email: string;
  subject?: string | null;
  description: string;
  platform?: string | null;
  incidentDate?: string | null;
  amountLost?: string | null;
  status: string;
  adminNotes?: string | null;
  createdAt: string;
}

export function ContentManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("alerts");

  const [alertDialog, setAlertDialog] = useState<{ open: boolean; data?: ScamAlert }>({ open: false });
  const [testimonialDialog, setTestimonialDialog] = useState<{ open: boolean; data?: Testimonial }>({ open: false });
  const [faqDialog, setFaqDialog] = useState<{ open: boolean; data?: FaqItem }>({ open: false });
  const [statDialog, setStatDialog] = useState<{ open: boolean; data?: SiteStatistic }>({ open: false });
  const [newsletterDialog, setNewsletterDialog] = useState<{ open: boolean; data?: NewsletterSubscriber }>({ open: false });
  // Per-dialog inline error so a 409 "Email already subscribed" shows in
  // the edit form rather than a generic toast (per Task #405).
  const [newsletterDialogError, setNewsletterDialogError] = useState<string | null>(null);
  // Track which row's quick toggle is in-flight so we can disable the
  // switch and avoid double-submits while the optimistic mutation runs.
  const [togglingSubscriberId, setTogglingSubscriberId] = useState<number | null>(null);
  // confirmDeleteId drives the inline "Are you sure?" prompt on the row.
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Bulk-select state for the newsletter tab.
  const [selectedNewsletterIds, setSelectedNewsletterIds] = useState<Set<number>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  // Filter/search state for the newsletter tab.
  const [subscriberSearch, setSubscriberSearch] = useState("");
  const [subscriberStatusFilter, setSubscriberStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const { data: alerts = [], isLoading: alertsLoading } = useQuery<ScamAlert[]>({
    queryKey: ["/api/admin/content/scam-alerts"],
    queryFn: () => apiRequest("/api/admin/content/scam-alerts"),
  });

  const { data: testimonials = [], isLoading: testimonialsLoading } = useQuery<Testimonial[]>({
    queryKey: ["/api/admin/content/testimonials"],
    queryFn: () => apiRequest("/api/admin/content/testimonials"),
  });

  const { data: faqs = [], isLoading: faqsLoading } = useQuery<FaqItem[]>({
    queryKey: ["/api/admin/content/faq"],
    queryFn: () => apiRequest("/api/admin/content/faq"),
  });

  const { data: stats = [], isLoading: statsLoading } = useQuery<SiteStatistic[]>({
    queryKey: ["/api/admin/content/statistics"],
    queryFn: () => apiRequest("/api/admin/content/statistics"),
  });

  const { data: subscribers = [], isLoading: subscribersLoading } = useQuery<NewsletterSubscriber[]>({
    queryKey: ["/api/admin/content/newsletter"],
    queryFn: () => apiRequest("/api/admin/content/newsletter"),
  });

  // NEWSLETTER_PRUNING_EFFECT_START
  useEffect(() => {
    if (selectedNewsletterIds.size === 0) return;
    const liveIds = new Set(subscribers.map((s) => s.id));
    const pruned = new Set([...selectedNewsletterIds].filter((id) => liveIds.has(id)));
    if (pruned.size !== selectedNewsletterIds.size) {
      setSelectedNewsletterIds(pruned);
    }
  }, [subscribers]);

  const filteredSubscribers = subscribers.filter((s) => {
    if (subscriberStatusFilter === "active" && !s.isActive) return false;
    if (subscriberStatusFilter === "inactive" && s.isActive) return false;
    if (subscriberSearch.trim()) {
      return s.email.toLowerCase().includes(subscriberSearch.trim().toLowerCase());
    }
    return true;
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/admin/content/contact-submissions"],
    queryFn: () => apiRequest("/api/admin/content/contact-submissions"),
  });

  const { data: complaints = [], isLoading: complaintsLoading } = useQuery<PublicComplaint[]>({
    queryKey: ["/api/admin/content/public-complaints"],
    queryFn: () => apiRequest("/api/admin/content/public-complaints"),
  });

  const alertMutation = useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: any }) => {
      if (id) {
        return apiRequest(`/api/admin/content/scam-alerts/${id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      return apiRequest("/api/admin/content/scam-alerts", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/scam-alerts"] });
      setAlertDialog({ open: false });
      toast({ title: "Success", description: "Scam alert saved" });
    },
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/content/scam-alerts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/scam-alerts"] });
      toast({ title: "Deleted", description: "Scam alert removed" });
    },
  });

  const testimonialMutation = useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: any }) => {
      if (id) {
        return apiRequest(`/api/admin/content/testimonials/${id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      return apiRequest("/api/admin/content/testimonials", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/testimonials"] });
      setTestimonialDialog({ open: false });
      toast({ title: "Success", description: "Testimonial saved" });
    },
  });

  const deleteTestimonialMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/content/testimonials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/testimonials"] });
      toast({ title: "Deleted", description: "Testimonial removed" });
    },
  });

  const faqMutation = useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: any }) => {
      if (id) {
        return apiRequest(`/api/admin/content/faq/${id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      return apiRequest("/api/admin/content/faq", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/faq"] });
      setFaqDialog({ open: false });
      toast({ title: "Success", description: "FAQ saved" });
    },
  });

  const deleteFaqMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/content/faq/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/faq"] });
      toast({ title: "Deleted", description: "FAQ removed" });
    },
  });

  const statMutation = useMutation({
    mutationFn: async ({ id, data }: { id?: number; data: any }) => {
      if (id) {
        return apiRequest(`/api/admin/content/statistics/${id}`, { method: "PUT", body: JSON.stringify(data) });
      }
      return apiRequest("/api/admin/content/statistics", { method: "POST", body: JSON.stringify(data) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/statistics"] });
      setStatDialog({ open: false });
      toast({ title: "Success", description: "Statistic saved" });
    },
  });

  const deleteStatMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/content/statistics/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/statistics"] });
      toast({ title: "Deleted", description: "Statistic removed" });
    },
  });

  // Newsletter subscriber edit/toggle mutation. Posts only the changed
  // fields to PUT /api/admin/content/newsletter/:id (Task #340 backend).
  // On 409 we surface the error inline via newsletterDialogError so the
  // admin can correct the email instead of seeing a generic toast.
  const newsletterMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { email?: string; isActive?: boolean; unsubscribedAt?: string | null };
    }) => {
      return apiRequest(`/api/admin/content/newsletter/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/newsletter"] });
      setNewsletterDialog({ open: false });
      setNewsletterDialogError(null);
      toast({ title: "Saved", description: "Subscriber updated" });
    },
    onError: (err: unknown) => {
      const isConflict = err instanceof ApiRequestError && err.status === 409;
      const message =
        err instanceof Error ? err.message : "Failed to update subscriber";
      if (isConflict && newsletterDialog.open) {
        // Duplicate-email conflict on the edit dialog is rendered inline
        // so the admin can fix the field in place (Task #405 spec).
        setNewsletterDialogError(message);
      } else {
        // All other failures (validation, network, server) fall back to
        // a destructive toast — including 409s from the row-level toggle
        // where no dialog is open to host an inline message.
        toast({
          title: isConflict ? "Conflict" : "Update failed",
          description: message,
          variant: "destructive",
        });
      }
    },
    onSettled: () => {
      setTogglingSubscriberId(null);
    },
  });

  const deleteNewsletterMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/admin/content/newsletter/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/newsletter"] });
      setConfirmDeleteId(null);
      toast({ title: "Deleted", description: "Subscriber removed" });
    },
    onError: () => {
      setConfirmDeleteId(null);
      toast({ title: "Delete failed", description: "Could not remove subscriber", variant: "destructive" });
    },
  });

  const bulkDeleteNewsletterMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.allSettled(
        ids.map((id) => apiRequest(`/api/admin/content/newsletter/${id}`, { method: "DELETE" }))
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: ids.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/newsletter"] });
      setSelectedNewsletterIds(new Set());
      setBulkDeleteDialogOpen(false);
      if (failed === 0) {
        toast({ title: "Deleted", description: `${total} subscriber${total !== 1 ? "s" : ""} removed` });
      } else {
        toast({
          title: "Partially deleted",
          description: `${total - failed} of ${total} removed; ${failed} failed`,
          variant: "destructive",
        });
      }
    },
    onError: () => {
      setBulkDeleteDialogOpen(false);
      toast({ title: "Delete failed", description: "Could not remove subscribers", variant: "destructive" });
    },
  });

  const contactMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest(`/api/admin/content/contact-submissions/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/contact-submissions"] });
      toast({ title: "Updated", description: "Contact status updated" });
    },
  });

  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [editingNotesText, setEditingNotesText] = useState("");

  const complaintMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest(`/api/admin/content/public-complaints/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/public-complaints"] });
      toast({ title: "Updated", description: "Complaint status updated" });
    },
  });

  const saveNotesMutation = useMutation({
    mutationFn: async ({ id, adminNotes }: { id: number; adminNotes: string }) => {
      return apiRequest(`/api/admin/content/public-complaints/${id}`, { method: "PUT", body: JSON.stringify({ adminNotes }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/public-complaints"] });
      setEditingNotesId(null);
      toast({ title: "Saved", description: "Admin notes saved" });
    },
  });

  const deleteComplaintMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/content/public-complaints/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/public-complaints"] });
      toast({ title: "Deleted", description: "Complaint removed" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Content Management</h2>
        <p className="text-slate-400 text-sm">Manage landing page content: alerts, testimonials, FAQ, and statistics.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-900 border-slate-800">
          <TabsTrigger value="alerts" className="data-[state=active]:bg-slate-800" data-testid="content-tab-alerts">
            <AlertTriangle className="w-4 h-4 mr-2" /> Scam Alerts ({alerts.length})
          </TabsTrigger>
          <TabsTrigger value="testimonials" className="data-[state=active]:bg-slate-800" data-testid="content-tab-testimonials">
            <Star className="w-4 h-4 mr-2" /> Testimonials ({testimonials.length})
          </TabsTrigger>
          <TabsTrigger value="faq" className="data-[state=active]:bg-slate-800" data-testid="content-tab-faq">
            <HelpCircle className="w-4 h-4 mr-2" /> FAQ ({faqs.length})
          </TabsTrigger>
          <TabsTrigger value="statistics" className="data-[state=active]:bg-slate-800" data-testid="content-tab-statistics">
            <BarChart3 className="w-4 h-4 mr-2" /> Statistics ({stats.length})
          </TabsTrigger>
          <TabsTrigger value="newsletter" className="data-[state=active]:bg-slate-800" data-testid="content-tab-newsletter">
            <Mail className="w-4 h-4 mr-2" /> Newsletter ({subscribers.length})
          </TabsTrigger>
          <TabsTrigger value="contacts" className="data-[state=active]:bg-slate-800" data-testid="content-tab-contacts">
            <MessageSquare className="w-4 h-4 mr-2" /> Contacts ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="complaints" className="data-[state=active]:bg-slate-800" data-testid="content-tab-complaints">
            <FileWarning className="w-4 h-4 mr-2" /> Complaints ({complaints.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alerts">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white">Scam Alerts</CardTitle>
              <Button onClick={() => setAlertDialog({ open: true })} className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-alert">
                <Plus className="w-4 h-4 mr-2" /> Add Alert
              </Button>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : alerts.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No scam alerts yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Title</TableHead>
                      <TableHead className="text-slate-300">Severity</TableHead>
                      <TableHead className="text-slate-300">Platform</TableHead>
                      <TableHead className="text-slate-300">Active</TableHead>
                      <TableHead className="text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((alert) => (
                      <TableRow key={alert.id} className="border-slate-700">
                        <TableCell className="text-white font-medium">{alert.title}</TableCell>
                        <TableCell>
                          <Badge className={
                            alert.severity === "critical" ? "bg-red-600" :
                            alert.severity === "high" ? "bg-orange-500" :
                            alert.severity === "medium" ? "bg-yellow-500" : "bg-blue-500"
                          }>
                            {alert.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-300">{alert.platformName || "-"}</TableCell>
                        <TableCell>
                          <Badge className={alert.isActive ? "bg-green-600" : "bg-slate-600"}>
                            {alert.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setAlertDialog({ open: true, data: alert })} data-testid={`button-edit-alert-${alert.id}`}>
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteAlertMutation.mutate(alert.id)} data-testid={`button-delete-alert-${alert.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="testimonials">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white">Testimonials</CardTitle>
              <Button onClick={() => setTestimonialDialog({ open: true })} className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-testimonial">
                <Plus className="w-4 h-4 mr-2" /> Add Testimonial
              </Button>
            </CardHeader>
            <CardContent>
              {testimonialsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : testimonials.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No testimonials yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Name</TableHead>
                      <TableHead className="text-slate-300">Location</TableHead>
                      <TableHead className="text-slate-300">Rating</TableHead>
                      <TableHead className="text-slate-300">Approved</TableHead>
                      <TableHead className="text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {testimonials.map((t) => (
                      <TableRow key={t.id} className="border-slate-700">
                        <TableCell className="text-white font-medium">{t.name}</TableCell>
                        <TableCell className="text-slate-300">{t.location || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} className={`w-4 h-4 ${i < t.rating ? "text-yellow-400 fill-yellow-400" : "text-slate-600"}`} />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={t.isApproved ? "bg-green-600" : "bg-slate-600"}>
                            {t.isApproved ? "Approved" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setTestimonialDialog({ open: true, data: t })} data-testid={`button-edit-testimonial-${t.id}`}>
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteTestimonialMutation.mutate(t.id)} data-testid={`button-delete-testimonial-${t.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faq">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white">FAQ Items</CardTitle>
              <Button onClick={() => setFaqDialog({ open: true })} className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-faq">
                <Plus className="w-4 h-4 mr-2" /> Add FAQ
              </Button>
            </CardHeader>
            <CardContent>
              {faqsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : faqs.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No FAQ items yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Order</TableHead>
                      <TableHead className="text-slate-300">Question</TableHead>
                      <TableHead className="text-slate-300">Active</TableHead>
                      <TableHead className="text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {faqs.sort((a, b) => a.displayOrder - b.displayOrder).map((faq) => (
                      <TableRow key={faq.id} className="border-slate-700">
                        <TableCell className="text-slate-400">{faq.displayOrder}</TableCell>
                        <TableCell className="text-white font-medium max-w-md truncate">{faq.question}</TableCell>
                        <TableCell>
                          <Badge className={faq.isActive ? "bg-green-600" : "bg-slate-600"}>
                            {faq.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setFaqDialog({ open: true, data: faq })} data-testid={`button-edit-faq-${faq.id}`}>
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteFaqMutation.mutate(faq.id)} data-testid={`button-delete-faq-${faq.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="statistics">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-white">Site Statistics</CardTitle>
              <Button onClick={() => setStatDialog({ open: true })} className="bg-blue-600 hover:bg-blue-700" data-testid="button-add-statistic">
                <Plus className="w-4 h-4 mr-2" /> Add Statistic
              </Button>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : stats.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No statistics yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Order</TableHead>
                      <TableHead className="text-slate-300">Label</TableHead>
                      <TableHead className="text-slate-300">Value</TableHead>
                      <TableHead className="text-slate-300">Key</TableHead>
                      <TableHead className="text-slate-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.sort((a, b) => a.displayOrder - b.displayOrder).map((stat) => (
                      <TableRow key={stat.id} className="border-slate-700">
                        <TableCell className="text-slate-400">{stat.displayOrder}</TableCell>
                        <TableCell className="text-white font-medium">{stat.label}</TableCell>
                        <TableCell className="text-slate-300 font-mono">{stat.value}</TableCell>
                        <TableCell className="text-slate-400">{stat.key}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setStatDialog({ open: true, data: stat })} data-testid={`button-edit-stat-${stat.id}`}>
                              <Edit3 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => { if (confirm("Delete this statistic?")) deleteStatMutation.mutate(stat.id); }} data-testid={`button-delete-stat-${stat.id}`}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="newsletter">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Newsletter Subscribers</CardTitle>
                <div className="flex items-center gap-2">
                  {subscribers.length > 0 && (() => {
                    const buildCsv = (rows: typeof subscribers) => {
                      const data = [
                        ["Email", "Subscribed Date", "Status"],
                        ...rows.map((s) => [
                          s.email,
                          new Date(s.subscribedAt).toISOString().split("T")[0],
                          s.isActive ? "Active" : "Unsubscribed",
                        ]),
                      ];
                      return data
                        .map((r) =>
                          r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
                        )
                        .join("\r\n");
                    };
                    const triggerDownload = (csv: string, filename: string) => {
                      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = filename;
                      a.click();
                      URL.revokeObjectURL(url);
                    };
                    const dateStamp = new Date().toISOString().split("T")[0];
                    const hasSelection = selectedNewsletterIds.size > 0;
                    const isFiltered = subscriberSearch.trim() !== "" || subscriberStatusFilter !== "all";
                    return (
                      // NEWSLETTER_EXPORT_CSV_BTN_START
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-slate-600 text-slate-200 hover:bg-slate-700"
                        data-testid="button-export-newsletter-csv"
                        disabled={bulkDeleteNewsletterMutation.isPending}
                        onClick={() => {
                          if (hasSelection) {
                            const selected = subscribers.filter((s) =>
                              selectedNewsletterIds.has(s.id)
                            );
                            triggerDownload(
                              buildCsv(selected),
                              `newsletter-subscribers-selected-${dateStamp}.csv`
                            );
                          } else if (isFiltered) {
                            triggerDownload(
                              buildCsv(filteredSubscribers),
                              `newsletter-subscribers-filtered-${dateStamp}.csv`
                            );
                          } else {
                            triggerDownload(
                              buildCsv(subscribers),
                              `newsletter-subscribers-${dateStamp}.csv`
                            );
                          }
                        }}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        {hasSelection
                          ? `Export selected (${selectedNewsletterIds.size})`
                          : isFiltered
                            ? `Export matching (${filteredSubscribers.length})`
                            : "Export CSV"}
                      </Button>
                    );
                  })()}
                  {selectedNewsletterIds.size > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={bulkDeleteNewsletterMutation.isPending}
                      onClick={() => setBulkDeleteDialogOpen(true)}
                      data-testid="button-bulk-delete-newsletter"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete selected ({selectedNewsletterIds.size})
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {subscribersLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : subscribers.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No subscribers yet</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      type="text"
                      placeholder="Search by email…"
                      value={subscriberSearch}
                      onChange={(e) => setSubscriberSearch(e.target.value)}
                      data-testid="input-search-newsletter"
                      className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <select
                      value={subscriberStatusFilter}
                      onChange={(e) => setSubscriberStatusFilter(e.target.value as "all" | "active" | "inactive")}
                      data-testid="select-newsletter-status-filter"
                      className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="all">All statuses</option>
                      <option value="active">Active</option>
                      <option value="inactive">Unsubscribed</option>
                    </select>
                    {(subscriberSearch.trim() !== "" || subscriberStatusFilter !== "all") && (
                      <button
                        type="button"
                        data-testid="button-clear-newsletter-filters"
                        onClick={() => {
                          setSubscriberSearch("");
                          setSubscriberStatusFilter("all");
                        }}
                        className="px-3 py-1.5 text-sm rounded border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-slate-100 transition-colors whitespace-nowrap"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                  {filteredSubscribers.length === 0 ? (
                    <div className="text-slate-400 text-center py-8">No subscribers match the current filter</div>
                  ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="w-10">
                        {/* NEWSLETTER_SELECT_ALL_CHECKBOX_START */}
                        <input
                          type="checkbox"
                          className="accent-red-500 w-4 h-4 cursor-pointer"
                          aria-label="Select all subscribers"
                          data-testid="checkbox-select-all-newsletter"
                          checked={filteredSubscribers.length > 0 && filteredSubscribers.every((s) => selectedNewsletterIds.has(s.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedNewsletterIds((prev) => {
                                const next = new Set(prev);
                                filteredSubscribers.forEach((s) => next.add(s.id));
                                return next;
                              });
                            } else {
                              setSelectedNewsletterIds((prev) => {
                                const next = new Set(prev);
                                filteredSubscribers.forEach((s) => next.delete(s.id));
                                return next;
                              });
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead className="text-slate-300">Email</TableHead>
                      <TableHead className="text-slate-300">Subscribed</TableHead>
                      <TableHead className="text-slate-300">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSubscribers.map((sub) => {
                      const isToggling =
                        togglingSubscriberId === sub.id && newsletterMutation.isPending;
                      const isSelected = selectedNewsletterIds.has(sub.id);
                      return (
                        <TableRow key={sub.id} className="border-slate-700" data-testid={`row-newsletter-subscriber-${sub.id}`}>
                          <TableCell>
                            {/* NEWSLETTER_ROW_CHECKBOX_START */}
                            <input
                              type="checkbox"
                              className="accent-red-500 w-4 h-4 cursor-pointer"
                              aria-label={`Select ${sub.email}`}
                              data-testid={`checkbox-newsletter-${sub.id}`}
                              checked={isSelected}
                              onChange={(e) => {
                                setSelectedNewsletterIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) {
                                    next.add(sub.id);
                                  } else {
                                    next.delete(sub.id);
                                  }
                                  return next;
                                });
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-white font-medium">{sub.email}</TableCell>
                          <TableCell className="text-slate-300">{new Date(sub.subscribedAt).toLocaleDateString()}</TableCell>
                          <TableCell>
                            <Badge
                              className={sub.isActive ? "bg-green-600" : "bg-slate-600"}
                              data-testid={`badge-newsletter-subscriber-status-${sub.id}`}
                            >
                              {sub.isActive ? "Active" : "Unsubscribed"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={sub.isActive}
                                  disabled={isToggling}
                                  onCheckedChange={(checked) => {
                                    // Flip isActive and pair it with an
                                    // unsubscribedAt stamp so the public
                                    // newsletter UI stays consistent (active
                                    // ↔ null, inactive ↔ now). The backend
                                    // accepts both fields on one PUT.
                                    setTogglingSubscriberId(sub.id);
                                    newsletterMutation.mutate({
                                      id: sub.id,
                                      data: {
                                        isActive: checked,
                                        unsubscribedAt: checked
                                          ? null
                                          : new Date().toISOString(),
                                      },
                                    });
                                  }}
                                  aria-label={
                                    sub.isActive
                                      ? `Unsubscribe ${sub.email}`
                                      : `Re-activate ${sub.email}`
                                  }
                                  data-testid={`switch-newsletter-active-${sub.id}`}
                                />
                                <span className="text-slate-400 text-xs">
                                  {sub.isActive ? "On" : "Off"}
                                </span>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setNewsletterDialogError(null);
                                  setNewsletterDialog({ open: true, data: sub });
                                }}
                                data-testid={`button-edit-newsletter-${sub.id}`}
                              >
                                <Edit3 className="w-4 h-4" />
                              </Button>
                              {confirmDeleteId === sub.id ? (
                                <div className="flex items-center gap-1" data-testid={`confirm-delete-newsletter-${sub.id}`}>
                                  <span className="text-xs text-slate-300">Delete?</span>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={deleteNewsletterMutation.isPending}
                                    onClick={() => deleteNewsletterMutation.mutate(sub.id)}
                                    data-testid={`button-confirm-delete-newsletter-${sub.id}`}
                                  >
                                    Yes
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmDeleteId(null)}
                                    data-testid={`button-cancel-delete-newsletter-${sub.id}`}
                                  >
                                    No
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setConfirmDeleteId(sub.id)}
                                  data-testid={`button-delete-newsletter-${sub.id}`}
                                  aria-label={`Delete ${sub.email}`}
                                >
                                  <Trash2 className="w-4 h-4 text-red-400" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Bulk-delete confirmation dialog */}
          <Dialog open={bulkDeleteDialogOpen} onOpenChange={(open) => { if (!bulkDeleteNewsletterMutation.isPending) setBulkDeleteDialogOpen(open); }}>
            <DialogContent className="bg-slate-800 border-slate-700 text-white">
              <DialogHeader>
                <DialogTitle className="text-white flex items-center gap-2">
                  <Trash2 className="w-5 h-5 text-red-400" />
                  Delete {selectedNewsletterIds.size} subscriber{selectedNewsletterIds.size !== 1 ? "s" : ""}?
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <p className="text-slate-300 text-sm">
                  The following subscriber{selectedNewsletterIds.size !== 1 ? "s" : ""} will be permanently deleted and cannot be recovered:
                </p>
                <ScrollArea className="max-h-48 rounded border border-slate-600 p-3">
                  <ul className="space-y-1" data-testid="bulk-delete-email-list">
                    {subscribers
                      .filter((s) => selectedNewsletterIds.has(s.id))
                      .map((s) => (
                        <li key={s.id} className="text-sm text-slate-200 font-mono" data-testid={`bulk-delete-email-${s.id}`}>
                          {s.email}
                        </li>
                      ))}
                  </ul>
                </ScrollArea>
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setBulkDeleteDialogOpen(false)}
                  disabled={bulkDeleteNewsletterMutation.isPending}
                  data-testid="button-bulk-delete-cancel"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => bulkDeleteNewsletterMutation.mutate(Array.from(selectedNewsletterIds))}
                  disabled={bulkDeleteNewsletterMutation.isPending}
                  data-testid="button-bulk-delete-confirm"
                >
                  {bulkDeleteNewsletterMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="w-4 h-4 mr-1" />
                  )}
                  Delete {selectedNewsletterIds.size}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="contacts">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Contact Submissions</CardTitle>
            </CardHeader>
            <CardContent>
              {contactsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : contacts.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No contact submissions yet</div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {contacts.map((contact) => (
                      <Card key={contact.id} className="bg-slate-900 border-slate-700">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h4 className="text-white font-medium">{contact.name}</h4>
                              <p className="text-slate-400 text-sm">{contact.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Select
                                value={contact.status}
                                onValueChange={(value) => contactMutation.mutate({ id: contact.id, status: value })}
                              >
                                <SelectTrigger className="w-32 bg-slate-800 border-slate-600 text-slate-300">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-slate-700">
                                  <SelectItem value="new">New</SelectItem>
                                  <SelectItem value="read">Read</SelectItem>
                                  <SelectItem value="replied">Replied</SelectItem>
                                  <SelectItem value="closed">Closed</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          {contact.subject && <p className="text-blue-400 text-sm mb-1">{contact.subject}</p>}
                          <p className="text-slate-300 text-sm">{contact.message}</p>
                          <p className="text-slate-500 text-xs mt-2">{new Date(contact.createdAt).toLocaleString()}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="complaints">
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Complaint Intake Queue</CardTitle>
            </CardHeader>
            <CardContent>
              {complaintsLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : complaints.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No complaint submissions yet</div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-4">
                    {complaints.map((complaint) => (
                      <Card key={complaint.id} className="bg-slate-900 border-slate-700" data-testid={`complaint-row-${complaint.id}`}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h4 className="text-white font-medium">{complaint.name}</h4>
                              <p className="text-slate-400 text-sm">{complaint.email}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Select
                                value={complaint.status ?? "new"}
                                onValueChange={(value) => complaintMutation.mutate({ id: complaint.id, status: value })}
                              >
                                <SelectTrigger className="w-36 bg-slate-800 border-slate-600 text-slate-300">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-800 border-slate-700">
                                  <SelectItem value="new">New</SelectItem>
                                  <SelectItem value="read">Read</SelectItem>
                                  <SelectItem value="actioned">Actioned</SelectItem>
                                  <SelectItem value="archived">Archived</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-400 hover:text-red-300"
                                onClick={() => deleteComplaintMutation.mutate(complaint.id)}
                                disabled={deleteComplaintMutation.isPending}
                                data-testid={`button-delete-complaint-${complaint.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          {complaint.subject && (
                            <p className="text-blue-400 text-sm mb-1 font-medium">{complaint.subject}</p>
                          )}
                          <div className="flex flex-wrap gap-3 mb-2">
                            {complaint.platform && (
                              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                                Platform: {complaint.platform}
                              </span>
                            )}
                            {complaint.incidentDate && (
                              <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                                Date: {complaint.incidentDate}
                              </span>
                            )}
                            {complaint.amountLost && (
                              <span className="text-xs bg-amber-900/60 text-amber-300 px-2 py-0.5 rounded">
                                Lost: {complaint.amountLost}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-300 text-sm whitespace-pre-wrap">{complaint.description}</p>

                          {editingNotesId === complaint.id ? (
                            <div className="mt-3 space-y-2" data-testid={`notes-editor-${complaint.id}`}>
                              <Textarea
                                value={editingNotesText}
                                onChange={(e) => setEditingNotesText(e.target.value)}
                                placeholder="Add admin notes…"
                                className="bg-slate-800 border-slate-600 text-slate-200 text-sm resize-none min-h-[72px]"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-500"
                                  onClick={() => saveNotesMutation.mutate({ id: complaint.id, adminNotes: editingNotesText })}
                                  disabled={saveNotesMutation.isPending || !editingNotesText.trim()}
                                  data-testid={`button-save-notes-${complaint.id}`}
                                >
                                  <Check className="w-3 h-3 mr-1" /> Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-3 text-xs text-slate-400 hover:text-slate-200"
                                  onClick={() => setEditingNotesId(null)}
                                  disabled={saveNotesMutation.isPending}
                                  data-testid={`button-cancel-notes-${complaint.id}`}
                                >
                                  <X className="w-3 h-3 mr-1" /> Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3">
                              {complaint.adminNotes ? (
                                <div className="bg-slate-800/60 border border-slate-700 rounded px-3 py-2 flex items-start justify-between gap-2">
                                  <p className="text-amber-300 text-xs whitespace-pre-wrap flex-1" data-testid={`notes-display-${complaint.id}`}>{complaint.adminNotes}</p>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
                                      onClick={() => { setEditingNotesId(complaint.id); setEditingNotesText(complaint.adminNotes ?? ""); }}
                                      data-testid={`button-edit-notes-${complaint.id}`}
                                      title="Edit notes"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-slate-400 hover:text-red-400"
                                      onClick={() => saveNotesMutation.mutate({ id: complaint.id, adminNotes: "" })}
                                      disabled={saveNotesMutation.isPending}
                                      data-testid={`button-clear-notes-${complaint.id}`}
                                      title="Clear notes"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-slate-500 hover:text-slate-300"
                                  onClick={() => { setEditingNotesId(complaint.id); setEditingNotesText(""); }}
                                  data-testid={`button-add-notes-${complaint.id}`}
                                >
                                  <Pencil className="w-3 h-3 mr-1" /> Add notes
                                </Button>
                              )}
                            </div>
                          )}

                          <p className="text-slate-500 text-xs mt-2">{new Date(complaint.createdAt).toLocaleString()}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog
        open={alertDialog.open}
        onClose={() => setAlertDialog({ open: false })}
        data={alertDialog.data}
        onSave={(data) => alertMutation.mutate({ id: alertDialog.data?.id, data })}
        isLoading={alertMutation.isPending}
      />

      <TestimonialDialog
        open={testimonialDialog.open}
        onClose={() => setTestimonialDialog({ open: false })}
        data={testimonialDialog.data}
        onSave={(data) => testimonialMutation.mutate({ id: testimonialDialog.data?.id, data })}
        isLoading={testimonialMutation.isPending}
      />

      <FaqDialog
        open={faqDialog.open}
        onClose={() => setFaqDialog({ open: false })}
        data={faqDialog.data}
        onSave={(data) => faqMutation.mutate({ id: faqDialog.data?.id, data })}
        isLoading={faqMutation.isPending}
      />

      <StatDialog
        open={statDialog.open}
        onClose={() => setStatDialog({ open: false })}
        data={statDialog.data}
        onSave={(data) => statMutation.mutate({ id: statDialog.data?.id, data })}
        isLoading={statMutation.isPending}
      />

      <NewsletterDialog
        open={newsletterDialog.open}
        onClose={() => {
          setNewsletterDialog({ open: false });
          setNewsletterDialogError(null);
        }}
        data={newsletterDialog.data}
        onSave={(patch) => {
          if (!newsletterDialog.data) return;
          setNewsletterDialogError(null);
          newsletterMutation.mutate({ id: newsletterDialog.data.id, data: patch });
        }}
        isLoading={newsletterMutation.isPending}
        errorMessage={newsletterDialogError}
      />
    </div>
  );
}

function AlertDialog({ open, onClose, data, onSave, isLoading }: { 
  open: boolean; 
  onClose: () => void; 
  data?: ScamAlert; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ title: "", description: "", severity: "medium", platformName: "", isActive: true });

  useState(() => {
    if (data) {
      setForm({
        title: data.title || "",
        description: data.description || "",
        severity: data.severity || "medium",
        platformName: data.platformName || "",
        isActive: data.isActive ?? true,
      });
    } else {
      setForm({ title: "", description: "", severity: "medium", platformName: "", isActive: true });
    }
  });

  const handleSubmit = () => {
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>{data ? "Edit Scam Alert" : "Add Scam Alert"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-alert-title" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-alert-description" />
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
              <SelectTrigger className="bg-slate-900 border-slate-600" data-testid="select-alert-severity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Platform Name</Label>
            <Input value={form.platformName} onChange={(e) => setForm({ ...form, platformName: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-alert-platform" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c })} data-testid="switch-alert-active" />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600">Cancel</Button>
          <Button onClick={handleSubmit} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700" data-testid="button-save-alert">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestimonialDialog({ open, onClose, data, onSave, isLoading }: { 
  open: boolean; 
  onClose: () => void; 
  data?: Testimonial; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ name: "", location: "", content: "", rating: 5, isApproved: true });

  useState(() => {
    if (data) {
      setForm({
        name: data.name || "",
        location: data.location || "",
        content: data.content || "",
        rating: data.rating || 5,
        isApproved: data.isApproved ?? true,
      });
    } else {
      setForm({ name: "", location: "", content: "", rating: 5, isApproved: true });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>{data ? "Edit Testimonial" : "Add Testimonial"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-testimonial-name" />
          </div>
          <div>
            <Label>Location/Title</Label>
            <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-testimonial-location" />
          </div>
          <div>
            <Label>Testimonial Content</Label>
            <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="bg-slate-900 border-slate-600" rows={4} data-testid="input-testimonial-content" />
          </div>
          <div>
            <Label>Rating (1-5)</Label>
            <Select value={String(form.rating)} onValueChange={(v) => setForm({ ...form, rating: parseInt(v) })}>
              <SelectTrigger className="bg-slate-900 border-slate-600" data-testid="select-testimonial-rating">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {[1,2,3,4,5].map(n => <SelectItem key={n} value={String(n)}>{n} Star{n > 1 ? "s" : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.isApproved} onCheckedChange={(c) => setForm({ ...form, isApproved: c })} data-testid="switch-testimonial-approved" />
            <Label>Approved</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600">Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700" data-testid="button-save-testimonial">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FaqDialog({ open, onClose, data, onSave, isLoading }: { 
  open: boolean; 
  onClose: () => void; 
  data?: FaqItem; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ question: "", answer: "", displayOrder: 1, isActive: true });

  useState(() => {
    if (data) {
      setForm({
        question: data.question || "",
        answer: data.answer || "",
        displayOrder: data.displayOrder || 1,
        isActive: data.isActive ?? true,
      });
    } else {
      setForm({ question: "", answer: "", displayOrder: 1, isActive: true });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>{data ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Question</Label>
            <Input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} className="bg-slate-900 border-slate-600" data-testid="input-faq-question" />
          </div>
          <div>
            <Label>Answer</Label>
            <Textarea value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} className="bg-slate-900 border-slate-600" rows={4} data-testid="input-faq-answer" />
          </div>
          <div>
            <Label>Display Order</Label>
            <Input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 1 })} className="bg-slate-900 border-slate-600" data-testid="input-faq-order" />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={(c) => setForm({ ...form, isActive: c })} data-testid="switch-faq-active" />
            <Label>Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600">Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700" data-testid="button-save-faq">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatDialog({ open, onClose, data, onSave, isLoading }: { 
  open: boolean; 
  onClose: () => void; 
  data?: SiteStatistic; 
  onSave: (data: any) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({ key: "", label: "", value: "", displayOrder: 1 });

  useState(() => {
    if (data) {
      setForm({
        key: data.key || "",
        label: data.label || "",
        value: data.value || "",
        displayOrder: data.displayOrder || 1,
      });
    } else {
      setForm({ key: "", label: "", value: "", displayOrder: 1 });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle>{data ? "Edit Statistic" : "Add Statistic"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Key (unique identifier)</Label>
            <Input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="bg-slate-900 border-slate-600" placeholder="e.g., cases_resolved" data-testid="input-stat-key" />
          </div>
          <div>
            <Label>Label (display name)</Label>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className="bg-slate-900 border-slate-600" placeholder="e.g., Cases Resolved" data-testid="input-stat-label" />
          </div>
          <div>
            <Label>Value</Label>
            <Input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="bg-slate-900 border-slate-600" placeholder="e.g., 15000+" data-testid="input-stat-value" />
          </div>
          <div>
            <Label>Display Order</Label>
            <Input type="number" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: parseInt(e.target.value) || 1 })} className="bg-slate-900 border-slate-600" data-testid="input-stat-order" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-600">Cancel</Button>
          <Button onClick={() => onSave(form)} disabled={isLoading} className="bg-blue-600 hover:bg-blue-700" data-testid="button-save-stat">
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewsletterDialog({
  open,
  onClose,
  data,
  onSave,
  isLoading,
  errorMessage,
}: {
  open: boolean;
  onClose: () => void;
  data?: NewsletterSubscriber;
  onSave: (patch: {
    email?: string;
    isActive?: boolean;
    unsubscribedAt?: string | null;
  }) => void;
  isLoading: boolean;
  errorMessage: string | null;
}) {
  const [email, setEmail] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [lastSyncedId, setLastSyncedId] = useState<number | null>(null);

  // Sync local form state when the dialog opens against a new row id
  // (or re-opens for a different row). useEffect would also work; this
  // identity-tracked branch keeps the component dependency-free.
  if (open && data && data.id !== lastSyncedId) {
    setEmail(data.email ?? "");
    setIsActive(!!data.isActive);
    setLastSyncedId(data.id);
  } else if (!open && lastSyncedId !== null) {
    setLastSyncedId(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="bg-slate-800 border-slate-700 text-white" data-testid="dialog-edit-newsletter">
        <DialogHeader>
          <DialogTitle>Edit subscriber</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="newsletter-email" className="text-slate-300">
              Email
            </Label>
            <Input
              id="newsletter-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-slate-900 border-slate-700 text-white"
              data-testid="input-newsletter-email"
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="newsletter-active" className="text-slate-300">
              Active
            </Label>
            <Switch
              id="newsletter-active"
              checked={isActive}
              onCheckedChange={setIsActive}
              data-testid="switch-newsletter-edit-active"
            />
          </div>
          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-900/40 px-3 py-2 text-sm text-red-200"
              data-testid="alert-newsletter-edit-error"
            >
              {errorMessage}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            className="border-slate-600"
            data-testid="button-newsletter-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!data) return;
              // Only send fields that actually changed so a typo-fix on
              // one field doesn't trip the other field's validation.
              const patch: {
                email?: string;
                isActive?: boolean;
                unsubscribedAt?: string | null;
              } = {};
              const trimmedEmail = email.trim();
              if (trimmedEmail && trimmedEmail !== data.email) {
                patch.email = trimmedEmail;
              }
              if (isActive !== data.isActive) {
                patch.isActive = isActive;
                patch.unsubscribedAt = isActive ? null : new Date().toISOString();
              }
              if (Object.keys(patch).length === 0) {
                onClose();
                return;
              }
              onSave(patch);
            }}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700"
            data-testid="button-newsletter-save"
          >
            {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
