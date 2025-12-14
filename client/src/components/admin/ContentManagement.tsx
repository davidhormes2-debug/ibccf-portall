import { useState } from "react";
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
import { Plus, Edit3, Trash2, AlertTriangle, Star, HelpCircle, BarChart3, Mail, MessageSquare, RefreshCw } from "lucide-react";

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

async function apiRequest(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error("Request failed");
  return res.json();
}

export function ContentManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("alerts");

  const [alertDialog, setAlertDialog] = useState<{ open: boolean; data?: ScamAlert }>({ open: false });
  const [testimonialDialog, setTestimonialDialog] = useState<{ open: boolean; data?: Testimonial }>({ open: false });
  const [faqDialog, setFaqDialog] = useState<{ open: boolean; data?: FaqItem }>({ open: false });
  const [statDialog, setStatDialog] = useState<{ open: boolean; data?: SiteStatistic }>({ open: false });

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

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/admin/content/contact-submissions"],
    queryFn: () => apiRequest("/api/admin/content/contact-submissions"),
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

  const contactMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiRequest(`/api/admin/content/contact-submissions/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/content/contact-submissions"] });
      toast({ title: "Updated", description: "Contact status updated" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Content Management</h2>
        <p className="text-slate-400 text-sm">Manage landing page content: alerts, testimonials, FAQ, and statistics.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-slate-800 border-slate-700">
          <TabsTrigger value="alerts" className="data-[state=active]:bg-slate-700" data-testid="content-tab-alerts">
            <AlertTriangle className="w-4 h-4 mr-2" /> Scam Alerts ({alerts.length})
          </TabsTrigger>
          <TabsTrigger value="testimonials" className="data-[state=active]:bg-slate-700" data-testid="content-tab-testimonials">
            <Star className="w-4 h-4 mr-2" /> Testimonials ({testimonials.length})
          </TabsTrigger>
          <TabsTrigger value="faq" className="data-[state=active]:bg-slate-700" data-testid="content-tab-faq">
            <HelpCircle className="w-4 h-4 mr-2" /> FAQ ({faqs.length})
          </TabsTrigger>
          <TabsTrigger value="statistics" className="data-[state=active]:bg-slate-700" data-testid="content-tab-statistics">
            <BarChart3 className="w-4 h-4 mr-2" /> Statistics ({stats.length})
          </TabsTrigger>
          <TabsTrigger value="newsletter" className="data-[state=active]:bg-slate-700" data-testid="content-tab-newsletter">
            <Mail className="w-4 h-4 mr-2" /> Newsletter ({subscribers.length})
          </TabsTrigger>
          <TabsTrigger value="contacts" className="data-[state=active]:bg-slate-700" data-testid="content-tab-contacts">
            <MessageSquare className="w-4 h-4 mr-2" /> Contacts ({contacts.length})
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
                          <Button variant="ghost" size="sm" onClick={() => setStatDialog({ open: true, data: stat })} data-testid={`button-edit-stat-${stat.id}`}>
                            <Edit3 className="w-4 h-4" />
                          </Button>
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
              <CardTitle className="text-white">Newsletter Subscribers</CardTitle>
            </CardHeader>
            <CardContent>
              {subscribersLoading ? (
                <div className="text-slate-400 text-center py-8">Loading...</div>
              ) : subscribers.length === 0 ? (
                <div className="text-slate-400 text-center py-8">No subscribers yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700">
                      <TableHead className="text-slate-300">Email</TableHead>
                      <TableHead className="text-slate-300">Subscribed</TableHead>
                      <TableHead className="text-slate-300">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribers.map((sub) => (
                      <TableRow key={sub.id} className="border-slate-700">
                        <TableCell className="text-white font-medium">{sub.email}</TableCell>
                        <TableCell className="text-slate-300">{new Date(sub.subscribedAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Badge className={sub.isActive ? "bg-green-600" : "bg-slate-600"}>
                            {sub.isActive ? "Active" : "Unsubscribed"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
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
