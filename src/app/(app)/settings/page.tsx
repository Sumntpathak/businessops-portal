"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  PageShell,
  Select,
  Toast,
  Badge,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Textarea,
} from "@/shared/ui";
import { useToast } from "@/shared/hooks/useToast";
import { cn } from "@/shared/utils/cn";
import { USER_PERMISSIONS } from "@/shared/constants";
import { Icon } from "@/shared/icons/Icon";
import { UserProfileEditor } from "@/features/users/components/UserProfileEditor";
import { UserFieldManager } from "@/features/users/components/UserFieldManager";

type TabType = "profile" | "security" | "preferences" | "integrations" | "invoice-setup" | "user-controls" | "workspace";

interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface AuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: string | null;
  createdAt: string;
}

interface UserLookup {
  id: string;
  name: string;
  email: string;
}

interface ManagedUser extends UserLookup {
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface UserPermissionRow {
  id: string;
  userId: string;
  permission: string;
  granted: boolean;
}

interface IntegrationConfig {
  id: string;
  type: "email" | "whatsapp" | "payment";
  provider: string;
  config: Record<string, unknown>;
  isEnabled: boolean;
}

interface Session {
  id: string;
  device: string;
  ip: string;
  active: boolean;
  lastActive: string;
}

const permissionCategories = ["messaging", "billing", "data", "operations", "admin"] as const;

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const { toast, showToast, clearToast } = useToast();

  // Profile Form State
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  // Preferences Form State
  const [dateFormat, setDateFormat] = useState("DD-MMM-YYYY");
  const [currency, setCurrency] = useState("INR");
  const [theme, setTheme] = useState("light");
  
  // Custom switch states for notifications
  const [notifyLeads, setNotifyLeads] = useState(true);
  const [notifyPayments, setNotifyPayments] = useState(true);
  const [notifySystem, setNotifySystem] = useState(false);
  const [defaultGstRate, setDefaultGstRate] = useState("18");
  const [autoApplyGst, setAutoApplyGst] = useState(true);
  const [invoiceTemplateTitle, setInvoiceTemplateTitle] = useState("Tax Invoice");
  const [invoiceTemplateNote, setInvoiceTemplateNote] = useState("Thank you for your business. Payment is due as per agreed terms.");
  const [signatureEnabled, setSignatureEnabled] = useState(true);
  const [signatureName, setSignatureName] = useState("");
  const [signatureDesignation, setSignatureDesignation] = useState("");

  // Active Sessions (mock for premium SaaS feeling)
  const [sessions, setSessions] = useState<Session[]>([
    { id: "current", device: "Chrome on Windows 11", ip: "192.168.1.45", active: true, lastActive: "Active now" },
    { id: "iphone", device: "Safari on iPhone 15", ip: "103.45.12.8", active: false, lastActive: "2 hours ago" },
    { id: "firefox", device: "Firefox on macOS Sonoma", ip: "84.21.90.11", active: false, lastActive: "3 days ago" },
  ]);
  const [revokingSessions, setRevokingSessions] = useState(false);

  // Workspace Info
  const [webhookSecret, setWebhookSecret] = useState("whsec_mock_5a782bd92e4a112fc89d");
  const [revealWebhook, setRevealWebhook] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [regeneratingWebhook, setRegeneratingWebhook] = useState(false);

  // Audit Logs database queries
  const [auditLogsData, setAuditLogsData] = useState<AuditLog[]>([]);
  const [usersList, setUsersList] = useState<UserLookup[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const auditLimit = 5;

  // Integration settings
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [savingIntegration, setSavingIntegration] = useState<string | null>(null);
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);
  const [emailIntegration, setEmailIntegration] = useState({
    provider: "smtp_mock",
    host: "smtp.mock-server.local",
    port: "587",
    senderEmail: "noreply@businessops.local",
    senderName: "BusinessOps Portal",
    smtpPassword: "",
    isEnabled: false,
  });
  const [whatsappIntegration, setWhatsappIntegration] = useState({
    provider: "twilio_mock",
    endpoint: "https://mock-wa.api.local/v1",
    phone: "+91-9876543210",
    namespace: "businessops_templates",
    isEnabled: false,
  });
  const [paymentIntegration, setPaymentIntegration] = useState({
    provider: "razorpay_mock",
    keyId: "rzp_mock_xxxxxxxxxxxxx",
    keySecret: "",
    currency: "INR",
    isEnabled: false,
  });
  const [revealPaymentSecret, setRevealPaymentSecret] = useState(false);

  // User controls
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [userPermissionMap, setUserPermissionMap] = useState<Record<string, UserPermissionRow[]>>({});
  const [loadingUserControls, setLoadingUserControls] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [savingPermission, setSavingPermission] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  useEffect(() => {
    async function loadMe() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const json = await res.json();
          const user = json.data as UserProfile;
          setProfile(user);
          setName(user.name);
          setEmail(user.email);
        } else {
          showToast("Failed to fetch session info", "error");
        }
      } catch {
        showToast("Network error loading profile", "error");
      } finally {
        setLoadingProfile(false);
      }
    }

    // Load local preferences
    const savedDateFormat = localStorage.getItem("pref_date_format") || "DD-MMM-YYYY";
    const savedCurrency = localStorage.getItem("pref_currency") || "INR";
    const savedTheme = localStorage.getItem("pref_theme") || "light";
    const savedNotifyLeads = localStorage.getItem("pref_notify_leads") !== "false";
    const savedNotifyPayments = localStorage.getItem("pref_notify_payments") !== "false";
    const savedNotifySystem = localStorage.getItem("pref_notify_system") === "true";
    const savedGstRate = localStorage.getItem("invoice_default_gst_rate") || "18";
    const savedAutoApplyGst = localStorage.getItem("invoice_auto_apply_gst") !== "false";
    const savedTemplateTitle = localStorage.getItem("invoice_template_title") || "Tax Invoice";
    const savedTemplateNote = localStorage.getItem("invoice_template_note") || "Thank you for your business. Payment is due as per agreed terms.";
    const savedSignatureEnabled = localStorage.getItem("invoice_signature_enabled") !== "false";
    const savedSignatureName = localStorage.getItem("invoice_signature_name") || "";
    const savedSignatureDesignation = localStorage.getItem("invoice_signature_designation") || "";

    setTimeout(() => {
      setDateFormat(savedDateFormat);
      setCurrency(savedCurrency);
      setTheme(savedTheme);
      setNotifyLeads(savedNotifyLeads);
      setNotifyPayments(savedNotifyPayments);
      setNotifySystem(savedNotifySystem);
      setDefaultGstRate(savedGstRate);
      setAutoApplyGst(savedAutoApplyGst);
      setInvoiceTemplateTitle(savedTemplateTitle);
      setInvoiceTemplateNote(savedTemplateNote);
      setSignatureEnabled(savedSignatureEnabled);
      setSignatureName(savedSignatureName);
      setSignatureDesignation(savedSignatureDesignation);
    }, 0);

    void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = profile?.role === "admin";
  const isManagement = profile ? (profile.role === "admin" || profile.role === "manager") : false;

  // Fetch real audit logs & users lookup if management tab is active
  const loadAuditData = useCallback(async (page: number) => {
    if (!isManagement) return;
    setLoadingAudit(true);
    try {
      const [auditRes, usersRes] = await Promise.all([
        fetch(`/api/audit-logs?page=${page}&limit=${auditLimit}`),
        fetch("/api/users"),
      ]);

      if (auditRes.ok && usersRes.ok) {
        const auditJson = await auditRes.json();
        const usersJson = await usersRes.json();
        setAuditLogsData(auditJson.data || []);
        setAuditTotal(auditJson.pagination?.total || 0);
        setUsersList(usersJson.data || []);
      }
    } catch (e) {
      console.error("[settings-audit-load]", e);
    } finally {
      setLoadingAudit(false);
    }
  }, [isManagement]);

  const loadIntegrations = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingIntegrations(true);
    try {
      const res = await fetch("/api/integrations");
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to load integrations", "error");
        return;
      }

      const rows = (json.data ?? []) as IntegrationConfig[];
      const email = rows.find((row) => row.type === "email");
      if (email) {
        setEmailIntegration({
          provider: email.provider,
          host: String(email.config.host ?? "smtp.mock-server.local"),
          port: String(email.config.port ?? "587"),
          senderEmail: String(email.config.senderEmail ?? "noreply@businessops.local"),
          senderName: String(email.config.senderName ?? "BusinessOps Portal"),
          smtpPassword: "", // never pre-fill password from DB
          isEnabled: email.isEnabled,
        });
      }

      const whatsapp = rows.find((row) => row.type === "whatsapp");
      if (whatsapp) {
        setWhatsappIntegration({
          provider: whatsapp.provider,
          endpoint: String(whatsapp.config.endpoint ?? "https://mock-wa.api.local/v1"),
          phone: String(whatsapp.config.phone ?? "+91-9876543210"),
          namespace: String(whatsapp.config.namespace ?? "businessops_templates"),
          isEnabled: whatsapp.isEnabled,
        });
      }

      const payment = rows.find((row) => row.type === "payment");
      if (payment) {
        setPaymentIntegration({
          provider: payment.provider,
          keyId: String(payment.config.keyId ?? "rzp_mock_xxxxxxxxxxxxx"),
          keySecret: String(payment.config.keySecret ?? ""),
          currency: String(payment.config.currency ?? "INR"),
          isEnabled: payment.isEnabled,
        });
      }
    } catch {
      showToast("Network error loading integrations", "error");
    } finally {
      setLoadingIntegrations(false);
    }
  }, [isAdmin, showToast]);

  const loadUserControls = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingUserControls(true);
    try {
      const res = await fetch("/api/users");
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to load users", "error");
        return;
      }

      const rows = (json.data ?? []) as ManagedUser[];
      setManagedUsers(rows);
      const permissionEntries = await Promise.all(rows.map(async (user) => {
        const permissionRes = await fetch(`/api/users/${user.id}/permissions`);
        if (!permissionRes.ok) return [user.id, []] as const;
        const permissionJson = await permissionRes.json();
        return [user.id, (permissionJson.data?.permissions ?? []) as UserPermissionRow[]] as const;
      }));
      setUserPermissionMap(Object.fromEntries(permissionEntries));
    } catch {
      showToast("Network error loading user controls", "error");
    } finally {
      setLoadingUserControls(false);
    }
  }, [isAdmin, showToast]);

  useEffect(() => {
    if (activeTab === "workspace" && isManagement) {
      setTimeout(() => {
        void loadAuditData(auditPage);
      }, 0);
    }
  }, [activeTab, auditPage, isManagement, loadAuditData]);

  useEffect(() => {
    if (activeTab === "integrations" && isAdmin) {
      setTimeout(() => {
        void loadIntegrations();
      }, 0);
    }
  }, [activeTab, isAdmin, loadIntegrations]);

  useEffect(() => {
    if (activeTab === "user-controls" && isAdmin) {
      setTimeout(() => {
        void loadUserControls();
      }, 0);
    }
  }, [activeTab, isAdmin, loadUserControls]);

  async function handleSaveIntegration(type: "email" | "whatsapp" | "payment") {
    setSavingIntegration(type);
    const payload = type === "email"
      ? {
          type,
          provider: emailIntegration.provider,
          isEnabled: emailIntegration.isEnabled,
          config: {
            host: emailIntegration.host,
            port: Number(emailIntegration.port || 587),
            senderEmail: emailIntegration.senderEmail,
            senderName: emailIntegration.senderName,
            // smtpPassword only saved when the admin fills it in; blank = keep existing
            ...(emailIntegration.smtpPassword ? { smtpPassword: emailIntegration.smtpPassword } : {}),
          },
        }
      : type === "whatsapp"
        ? {
            type,
            provider: whatsappIntegration.provider,
            isEnabled: whatsappIntegration.isEnabled,
            config: {
              endpoint: whatsappIntegration.endpoint,
              phone: whatsappIntegration.phone,
              namespace: whatsappIntegration.namespace,
            },
          }
        : {
            type,
            provider: paymentIntegration.provider,
            isEnabled: paymentIntegration.isEnabled,
            config: {
              keyId: paymentIntegration.keyId,
              keySecret: paymentIntegration.keySecret,
              currency: paymentIntegration.currency,
            },
          };

    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to save integration", "error");
        return;
      }
      showToast("Integration configuration saved");
      void loadIntegrations();
    } catch {
      showToast("Network error saving integration", "error");
    } finally {
      setSavingIntegration(null);
    }
  }

  async function handleTestIntegration(type: "email" | "whatsapp" | "payment", provider: string) {
    setTestingIntegration(type);
    try {
      const res = await fetch("/api/integrations/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, provider }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Connection test failed", "error");
        return;
      }
      showToast(json.data?.message ?? "Connection test passed (mock)");
    } catch {
      showToast("Network error testing integration", "error");
    } finally {
      setTestingIntegration(null);
    }
  }

  async function handleToggleManagedUser(user: ManagedUser) {
    setUpdatingUserId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to update user", "error");
        return;
      }
      setManagedUsers((prev) => prev.map((row) => row.id === user.id ? { ...row, isActive: !user.isActive } : row));
      showToast(`User ${user.isActive ? "deactivated" : "activated"}`);
    } catch {
      showToast("Network error updating user", "error");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleToggleUserPermission(userId: string, permission: string, granted: boolean) {
    setSavingPermission(`${userId}:${permission}`);
    try {
      const res = await fetch(`/api/users/${userId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: [{ permission, granted }] }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to update permission", "error");
        return;
      }
      setUserPermissionMap((prev) => ({
        ...prev,
        [userId]: (json.data?.permissions ?? []) as UserPermissionRow[],
      }));
      showToast("Permission updated");
    } catch {
      showToast("Network error updating permission", "error");
    } finally {
      setSavingPermission(null);
    }
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUpdatingProfile(true);
    setProfileErrors({});

    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details) {
          setProfileErrors(
            Object.fromEntries(
              Object.entries(data.details as Record<string, string[]>).map(([k, v]) => [k, v[0]])
            )
          );
        }
        showToast(data.error ?? "Failed to update profile", "error");
      } else {
        showToast("Profile updated successfully");
        setProfile((prev) => (prev ? { ...prev, name, email } : null));
        // Force window refresh to sync sidebar user details
        window.location.reload();
      }
    } catch {
      showToast("Network error during update", "error");
    } finally {
      setUpdatingProfile(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUpdatingPassword(true);
    setPasswordErrors({});

    if (newPassword !== confirmPassword) {
      setPasswordErrors({ confirmPassword: "Passwords do not match" });
      setUpdatingPassword(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details) {
          setPasswordErrors(
            Object.fromEntries(
              Object.entries(data.details as Record<string, string[]>).map(([k, v]) => [k, v[0]])
            )
          );
        }
        showToast(data.error ?? "Failed to change password", "error");
      } else {
        showToast("Password updated successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      showToast("Network error changing password", "error");
    } finally {
      setUpdatingPassword(false);
    }
  }

  const handleThemeChange = (newTheme: string) => {
    setTheme(newTheme);
    localStorage.setItem("pref_theme", newTheme);
    
    // Apply theme
    if (typeof window !== "undefined") {
      const root = window.document.documentElement;
      if (newTheme === "dark") {
        root.classList.add("dark");
      } else if (newTheme === "light") {
        root.classList.remove("dark");
      } else {
        const systemPref = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (systemPref) {
          root.classList.add("dark");
        } else {
          root.classList.remove("dark");
        }
      }
    }
  };

  function handleSavePreferences(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("pref_date_format", dateFormat);
    localStorage.setItem("pref_currency", currency);
    handleThemeChange(theme);
    showToast("Preferences saved. Changes will apply across the portal.");
  }

  function handleSaveInvoiceSetup(e: React.FormEvent) {
    e.preventDefault();
    localStorage.setItem("invoice_default_gst_rate", defaultGstRate);
    localStorage.setItem("invoice_auto_apply_gst", String(autoApplyGst));
    localStorage.setItem("invoice_template_title", invoiceTemplateTitle);
    localStorage.setItem("invoice_template_note", invoiceTemplateNote);
    localStorage.setItem("invoice_signature_enabled", String(signatureEnabled));
    localStorage.setItem("invoice_signature_name", signatureName);
    localStorage.setItem("invoice_signature_designation", signatureDesignation);
    showToast("Invoice setup saved. New invoices will use these defaults.");
  }

  // Handle immediate local storage sync for notification switches
  const handleToggleNotification = (key: string, value: boolean, setter: (val: boolean) => void) => {
    setter(value);
    localStorage.setItem(key, String(value));
    showToast("Notification preferences updated.");
  };

  function handleRegenerateWebhook() {
    setRegeneratingWebhook(true);
    setTimeout(() => {
      const randomHex = Array.from({ length: 20 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join("");
      setWebhookSecret(`whsec_mock_${randomHex}`);
      setRegeneratingWebhook(false);
      setShowRegenerateConfirm(false);
      showToast("New webhook secret generated. Please update your listener settings.");
    }, 1000);
  }

  const handleCopyWebhook = () => {
    if (typeof navigator !== "undefined") {
      void navigator.clipboard.writeText(webhookSecret).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        showToast("Webhook secret copied to clipboard");
      });
    }
  };

  const handleRevokeSessions = () => {
    setRevokingSessions(true);
    setTimeout(() => {
      setSessions((prev) => prev.filter((s) => s.active));
      setRevokingSessions(false);
      showToast("Signed out of all other devices successfully");
    }, 1500);
  };

  // Helper to format date depending on local preferences
  const formatDate = (dateStr: string | Date, formatStr: string) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return String(dateStr);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");

    if (formatStr === "YYYY-MM-DD") {
      return `${yyyy}-${mm}-${dd}`;
    }

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mmm = months[date.getMonth()];
    return `${dd}-${mmm}-${yyyy}`;
  };

  // Helpers for Audit logs lookups
  const getActorName = (actorUserId: string | null) => {
    if (!actorUserId) return "System Webhook";
    const user = usersList.find((u) => u.id === actorUserId);
    return user ? user.name : "Unknown User";
  };

  const getActionBadgeClass = (action: string) => {
    const act = action.toUpperCase();
    if (act.includes("SUCCESS") || act.includes("CREATED") || act.includes("RECORDED")) {
      return "border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold";
    }
    if (act.includes("FAILED") || act.includes("DELETED")) {
      return "border-rose-200 bg-rose-50 text-rose-700 font-semibold";
    }
    if (act.includes("UPDATED") || act.includes("ASSIGNED") || act.includes("SENT")) {
      return "border-amber-200 bg-amber-50 text-amber-700 font-semibold";
    }
    return "border-blue-200 bg-blue-50 text-blue-700 font-semibold";
  };

  const humanizeAction = (action: string) => {
    return action
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (loadingProfile) {
    return <EmptyState title="Loading..." description="Fetching your settings." />;
  }

  if (!profile) {
    return <EmptyState title="Access Denied" description="Could not load your workspace profile." />;
  }

  const userInitials = profile.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const getRoleBadgeClass = (role: string) => {
    switch (role.toLowerCase()) {
      case "admin":
        return "border-blue-200 bg-blue-50 text-blue-700 font-semibold";
      case "manager":
        return "border-indigo-200 bg-indigo-50 text-indigo-700";
      case "finance":
        return "border-emerald-200 bg-emerald-50 text-emerald-700";
      default:
        return "border-gray-200 bg-gray-50 text-gray-700";
    }
  };

  const getPermissionGranted = (userId: string, permission: string) => {
    return Boolean(userPermissionMap[userId]?.find((row) => row.permission === permission)?.granted);
  };

  const getPermissionCount = (userId: string) => {
    return userPermissionMap[userId]?.filter((row) => row.granted).length ?? 0;
  };

  const DATE_OPTIONS = [
    { label: "DD-MMM-YYYY (e.g. 24-Oct-2025)", value: "DD-MMM-YYYY" },
    { label: "YYYY-MM-DD (e.g. 2025-10-24)", value: "YYYY-MM-DD" },
  ];

  const CURRENCY_OPTIONS = [
    { label: "INR (Rs.)", value: "INR" },
    { label: "USD ($)", value: "USD" },
    { label: "EUR (€)", value: "EUR" },
  ];

  const THEME_OPTIONS = [
    { label: "Light Theme", value: "light" },
    { label: "Dark Theme (Beta)", value: "dark" },
    { label: "System Default", value: "system" },
  ];

  const tabs = [
    { id: "profile", label: "Profile", icon: (
      <Icon name="user" className="mr-2" />
    )},
    { id: "security", label: "Security", icon: (
      <Icon name="shieldKey" className="mr-2" />
    )},
    { id: "preferences", label: "Preferences", icon: (
      <Icon name="sliders" className="mr-2" />
    )},
    ...(isAdmin ? [{ id: "integrations", label: "Integrations", icon: (
      <Icon name="plug" className="mr-2" />
    )}] : []),
    ...(isAdmin ? [{ id: "invoice-setup", label: "Invoice Setup", icon: (
      <Icon name="invoice" className="mr-2" />
    )}] : []),
    ...(isAdmin ? [{ id: "user-controls", label: "User Controls", icon: (
      <Icon name="shieldKey" className="mr-2" />
    )}] : []),
    ...(isManagement ? [{ id: "workspace", label: "Workspace", icon: (
      <Icon name="building" className="mr-2" />
    )}] : []),
  ];

  return (
    <PageShell
      title="Settings"
      description="Manage your user profile, change security credentials, configure localization formats, and manage developer workspace API settings."
      width="full"
    >
      <div className="flex flex-col md:flex-row gap-8 mt-4">
        {/* Sleek Sidebar Navigation */}
        <aside className="w-full md:w-64 shrink-0 flex flex-row md:flex-col overflow-x-auto md:overflow-x-visible border-b md:border-b-0 md:border-r border-gray-200 pb-2 md:pb-0 md:pr-6 gap-1 scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={cn(
                  "flex items-center whitespace-nowrap px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-150 text-left w-auto md:w-full",
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-gray-500 hover:text-gray-900 hover:bg-gray-100/70"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </aside>

        {/* Setting Content Panel */}
        <div className="flex-1 space-y-6 max-w-4xl">
          {/* TAB 1: PROFILE */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              {/* Profile Card Summary */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardBody className="p-6">
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
                    <span className="grid size-16 place-items-center rounded-full bg-blue-100/60 text-xl font-bold text-blue-800 ring-4 ring-blue-50/50">
                      {userInitials}
                    </span>
                    <div className="flex-1 text-center sm:text-left space-y-1">
                      <div className="flex flex-col sm:flex-row items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">{profile.name}</h2>
                        <Badge className={cn("text-xs py-0.5", getRoleBadgeClass(profile.role))}>
                          {profile.role.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500">{profile.email}</p>
                      <p className="text-xs text-gray-400 max-w-lg mt-1">
                        Avatar generated automatically. Role updates can only be completed by workspace administrators.
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Profile Fields — full editor with phone, custom fields, confirm dialog */}
              {profile.id && <UserProfileEditor userId={profile.id} />}
            </div>
          )}

          {/* TAB 2: SECURITY */}
          {activeTab === "security" && (
            <div className="space-y-6">
              {/* Password Credentials */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Password Credentials</CardTitle>
                  <p className="text-xs text-gray-400">Rotate and secure your login password credentials.</p>
                </CardHeader>
                <CardBody className="p-5">
                  <form onSubmit={handlePasswordSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Input
                        label="Current Password"
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        required
                        error={passwordErrors.currentPassword}
                      />
                      <Input
                        label="New Password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        hint="Min. 8 characters"
                        error={passwordErrors.newPassword}
                      />
                      <Input
                        label="Confirm New Password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        error={passwordErrors.confirmPassword}
                      />
                    </div>
                    <div className="flex justify-end pt-4 border-t border-gray-100">
                      <Button type="submit" disabled={updatingPassword}>
                        {updatingPassword ? "Changing password..." : "Update password"}
                      </Button>
                    </div>
                  </form>
                </CardBody>
              </Card>

              {/* Active Sessions Simulator */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Active Web Sessions</CardTitle>
                  <p className="text-xs text-gray-400">
                    Devices currently signed into this account. Revoke access to log out from other browsers.
                  </p>
                </CardHeader>
                <CardBody className="p-5">
                  <div className="divide-y divide-gray-100">
                    {sessions.map((sess) => (
                      <div key={sess.id} className="py-3 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {/* Device icon (SVG Laptop/Phone) */}
                          <div className="p-2 rounded-lg bg-gray-50 border border-gray-200/60 text-gray-400">
                            <Icon name={sess.device.toLowerCase().includes("iphone") ? "smartphone" : "monitor"} className="size-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">{sess.device}</span>
                              {sess.active && (
                                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  <span className="size-1.5 rounded-full bg-emerald-600 animate-pulse" />
                                  Current Device
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">IP address: {sess.ip} • Last active: {sess.lastActive}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {sessions.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
                      <Button variant="danger" size="sm" onClick={handleRevokeSessions} disabled={revokingSessions}>
                        {revokingSessions ? "Revoking sessions..." : "Revoke other sessions"}
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>
            </div>
          )}

          {/* TAB 3: PREFERENCES */}
          {activeTab === "preferences" && (
            <div className="space-y-6">
              {/* Localization Form */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Personalization Preferences</CardTitle>
                  <p className="text-xs text-gray-400">Adjust date formats, active currency, and theme parameters.</p>
                </CardHeader>
                <CardBody className="p-5">
                  <form onSubmit={handleSavePreferences} className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Select
                        label="Date Format"
                        value={dateFormat}
                        onChange={(e) => setDateFormat(e.target.value)}
                        options={DATE_OPTIONS}
                      />
                      <Select
                        label="Currency Format"
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        options={CURRENCY_OPTIONS}
                      />
                      <Select
                        label="Interface Theme"
                        value={theme}
                        onChange={(e) => handleThemeChange(e.target.value)}
                        options={THEME_OPTIONS}
                      />
                    </div>
                    <div className="flex justify-end pt-4 border-t border-gray-100">
                      <Button type="submit">Save preferences</Button>
                    </div>
                  </form>
                </CardBody>
              </Card>

              {/* Notification Preferences Card */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Notification Subscriptions</CardTitle>
                  <p className="text-xs text-gray-400">Manage how you receive alerts and summaries from the platform.</p>
                </CardHeader>
                <CardBody className="p-5">
                  <div className="space-y-4">
                    {/* Toggle row 1 */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-50">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-gray-800" htmlFor="notify-leads">Lead Assignments</label>
                        <p className="text-xs text-gray-400">Notify me immediately when a new lead is assigned to my profile.</p>
                      </div>
                      <button
                        id="notify-leads"
                        type="button"
                        onClick={() => handleToggleNotification("pref_notify_leads", !notifyLeads, setNotifyLeads)}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          notifyLeads ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            notifyLeads ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>

                    {/* Toggle row 2 */}
                    <div className="flex items-center justify-between pb-3 border-b border-gray-50">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-gray-800" htmlFor="notify-payments">Invoice Payments</label>
                        <p className="text-xs text-gray-400">Receive transactional alerts when invoices are fully paid by clients.</p>
                      </div>
                      <button
                        id="notify-payments"
                        type="button"
                        onClick={() => handleToggleNotification("pref_notify_payments", !notifyPayments, setNotifyPayments)}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          notifyPayments ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            notifyPayments ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>

                    {/* Toggle row 3 */}
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium text-gray-800" htmlFor="notify-system">System Health Digests</label>
                        <p className="text-xs text-gray-400">Receive alerts regardingScheduled maintenance window tasks or security reports.</p>
                      </div>
                      <button
                        id="notify-system"
                        type="button"
                        onClick={() => handleToggleNotification("pref_notify_system", !notifySystem, setNotifySystem)}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          notifySystem ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span
                          className={cn(
                            "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                            notifySystem ? "translate-x-5" : "translate-x-0"
                          )}
                        />
                      </button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {/* TAB 4: INTEGRATIONS */}
          {activeTab === "integrations" && isAdmin && (
            <div className="space-y-6">
              {loadingIntegrations && (
                <Card className="shadow-sm border-gray-200/80 bg-white">
                  <CardBody className="p-5 text-sm text-gray-500">Loading integration settings...</CardBody>
                </Card>
              )}

              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Email / SMTP Configuration</CardTitle>
                  <p className="text-xs text-gray-400">
                    Used for all outbound emails — including password reset links for all users (demo and real).
                    Supports any SMTP provider: Brevo, Gmail, SendGrid, etc.
                  </p>
                  <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <strong>Brevo (free):</strong> Host: <code>smtp-relay.brevo.com</code> · Port: <code>587</code> · Login = Brevo SMTP login · Password = Brevo SMTP key
                  </div>
                </CardHeader>
                <CardBody className="p-5 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Provider"
                      value={emailIntegration.provider}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, provider: e.target.value }))}
                      options={[
                        { label: "Brevo (Sendinblue)", value: "brevo" },
                        { label: "Gmail SMTP", value: "gmail" },
                        { label: "Custom SMTP", value: "smtp_custom" },
                        { label: "Mock / Disabled", value: "smtp_mock" },
                      ]}
                    />
                    <Input
                      label="SMTP Host"
                      value={emailIntegration.host}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="smtp-relay.brevo.com"
                    />
                    <Input
                      label="SMTP Port"
                      type="number"
                      value={emailIntegration.port}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, port: e.target.value }))}
                    />
                    <Input
                      label="SMTP Login / Sender Email"
                      type="email"
                      value={emailIntegration.senderEmail}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, senderEmail: e.target.value }))}
                      placeholder="adbe62001@smtp-brevo.com"
                    />
                    <Input
                      label="Sender Display Name"
                      value={emailIntegration.senderName}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, senderName: e.target.value }))}
                      placeholder="BusinessOps"
                    />
                    <Input
                      label="SMTP Password / API Key"
                      type="password"
                      value={emailIntegration.smtpPassword}
                      onChange={(e) => setEmailIntegration((prev) => ({ ...prev, smtpPassword: e.target.value }))}
                      placeholder="xsmtpsib-... (leave blank to keep saved)"
                    />
                    <div className="flex items-end justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Enable email sending</p>
                        <p className="text-xs text-gray-400">Password reset emails require this to be enabled.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEmailIntegration((prev) => ({ ...prev, isEnabled: !prev.isEnabled }))}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          emailIntegration.isEnabled ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", emailIntegration.isEnabled ? "translate-x-5" : "translate-x-0")} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                    <Button variant="secondary" type="button" onClick={() => handleTestIntegration("email", emailIntegration.provider)} disabled={testingIntegration === "email"}>
                      {testingIntegration === "email" ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button type="button" onClick={() => handleSaveIntegration("email")} disabled={savingIntegration === "email"}>
                      {savingIntegration === "email" ? "Saving..." : "Save Configuration"}
                    </Button>
                  </div>
                </CardBody>
              </Card>

              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>WhatsApp Business Configuration</CardTitle>
                  <p className="text-xs text-gray-400">Store mocked WhatsApp provider settings for operational messages.</p>
                </CardHeader>
                <CardBody className="p-5 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Provider"
                      value={whatsappIntegration.provider}
                      onChange={(e) => setWhatsappIntegration((prev) => ({ ...prev, provider: e.target.value }))}
                      options={[
                        { label: "Mock Twilio WhatsApp", value: "twilio_mock" },
                        { label: "Mock WhatsApp Business API", value: "whatsapp_business_mock" },
                      ]}
                    />
                    <Input
                      label="API Endpoint"
                      value={whatsappIntegration.endpoint}
                      onChange={(e) => setWhatsappIntegration((prev) => ({ ...prev, endpoint: e.target.value }))}
                    />
                    <Input
                      label="Business Phone Number"
                      value={whatsappIntegration.phone}
                      onChange={(e) => setWhatsappIntegration((prev) => ({ ...prev, phone: e.target.value }))}
                    />
                    <Input
                      label="Template Namespace"
                      value={whatsappIntegration.namespace}
                      onChange={(e) => setWhatsappIntegration((prev) => ({ ...prev, namespace: e.target.value }))}
                    />
                    <div className="flex items-end justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3 sm:col-span-2">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Enable WhatsApp sending</p>
                        <p className="text-xs text-gray-400">Allows permitted users to send mock WhatsApp messages.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setWhatsappIntegration((prev) => ({ ...prev, isEnabled: !prev.isEnabled }))}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          whatsappIntegration.isEnabled ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", whatsappIntegration.isEnabled ? "translate-x-5" : "translate-x-0")} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                    <Button variant="secondary" type="button" onClick={() => handleTestIntegration("whatsapp", whatsappIntegration.provider)} disabled={testingIntegration === "whatsapp"}>
                      {testingIntegration === "whatsapp" ? "Testing..." : "Test Connection"}
                    </Button>
                    <Button type="button" onClick={() => handleSaveIntegration("whatsapp")} disabled={savingIntegration === "whatsapp"}>
                      {savingIntegration === "whatsapp" ? "Saving..." : "Save Configuration"}
                    </Button>
                  </div>
                </CardBody>
              </Card>

              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Payment Gateway Configuration</CardTitle>
                  <p className="text-xs text-gray-400">Configure a mocked gateway for invoice payment links.</p>
                </CardHeader>
                <CardBody className="p-5 space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Select
                      label="Gateway"
                      value={paymentIntegration.provider}
                      onChange={(e) => setPaymentIntegration((prev) => ({ ...prev, provider: e.target.value }))}
                      options={[
                        { label: "Mock Razorpay", value: "razorpay_mock" },
                        { label: "Mock Stripe", value: "stripe_mock" },
                        { label: "Mock PayU", value: "payu_mock" },
                      ]}
                    />
                    <Select
                      label="Currency"
                      value={paymentIntegration.currency}
                      onChange={(e) => setPaymentIntegration((prev) => ({ ...prev, currency: e.target.value }))}
                      options={[
                        { label: "INR", value: "INR" },
                        { label: "USD", value: "USD" },
                        { label: "EUR", value: "EUR" },
                      ]}
                    />
                    <Input
                      label="API Key ID"
                      type="password"
                      value={paymentIntegration.keyId}
                      onChange={(e) => setPaymentIntegration((prev) => ({ ...prev, keyId: e.target.value }))}
                    />
                    <div className="space-y-1">
                      <Input
                        label="API Key Secret"
                        type={revealPaymentSecret ? "text" : "password"}
                        value={paymentIntegration.keySecret}
                        onChange={(e) => setPaymentIntegration((prev) => ({ ...prev, keySecret: e.target.value }))}
                      />
                      <Button variant="secondary" size="sm" type="button" onClick={() => setRevealPaymentSecret((prev) => !prev)}>
                        {revealPaymentSecret ? "Hide" : "Reveal"}
                      </Button>
                    </div>
                    <Input
                      label="Webhook URL"
                      readOnly
                      value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/payments/mock-webhook`}
                    />
                    <div className="flex items-end justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-800">Enable payment gateway</p>
                        <p className="text-xs text-gray-400">Shows mock payment link controls on invoices.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPaymentIntegration((prev) => ({ ...prev, isEnabled: !prev.isEnabled }))}
                        className={cn(
                          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                          paymentIntegration.isEnabled ? "bg-blue-600" : "bg-gray-200"
                        )}
                      >
                        <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", paymentIntegration.isEnabled ? "translate-x-5" : "translate-x-0")} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                    <Button variant="secondary" type="button" onClick={() => handleTestIntegration("payment", paymentIntegration.provider)} disabled={testingIntegration === "payment"}>
                      {testingIntegration === "payment" ? "Testing..." : "Test Gateway"}
                    </Button>
                    <Button type="button" onClick={() => handleSaveIntegration("payment")} disabled={savingIntegration === "payment"}>
                      {savingIntegration === "payment" ? "Saving..." : "Save Configuration"}
                    </Button>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}

          {/* TAB 5: INVOICE SETUP */}
          {activeTab === "invoice-setup" && isAdmin && (
            <div className="space-y-6">
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Invoice Template & GST Defaults</CardTitle>
                  <p className="text-xs text-gray-400">Set lightweight defaults used when admins or finance create new invoices.</p>
                </CardHeader>
                <CardBody className="p-5">
                  <form onSubmit={handleSaveInvoiceSetup} className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="Default GST Tax (%)"
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={defaultGstRate}
                        onChange={(e) => setDefaultGstRate(e.target.value)}
                        hint="Auto-filled on the New Invoice page."
                      />
                      <div className="flex items-end justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">Auto apply GST</p>
                          <p className="text-xs text-gray-400">Use this GST rate by default for each new invoice.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAutoApplyGst((prev) => !prev)}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                            autoApplyGst ? "bg-blue-600" : "bg-gray-200"
                          )}
                        >
                          <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", autoApplyGst ? "translate-x-5" : "translate-x-0")} />
                        </button>
                      </div>
                      <Input
                        label="Invoice Template Title"
                        value={invoiceTemplateTitle}
                        onChange={(e) => setInvoiceTemplateTitle(e.target.value)}
                        placeholder="Tax Invoice"
                      />
                      <Textarea
                        label="Standard Template Note"
                        rows={3}
                        value={invoiceTemplateNote}
                        onChange={(e) => setInvoiceTemplateNote(e.target.value)}
                        wrapperClassName="sm:col-span-2"
                      />
                    </div>

                    <div className="rounded-lg border border-gray-200 bg-gray-50/40 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">Digital Signature</p>
                          <p className="text-xs text-gray-400">Adds a standard authorized-signatory block to invoice previews.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSignatureEnabled((prev) => !prev)}
                          className={cn(
                            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
                            signatureEnabled ? "bg-blue-600" : "bg-gray-200"
                          )}
                        >
                          <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", signatureEnabled ? "translate-x-5" : "translate-x-0")} />
                        </button>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <Input
                          label="Signature Name"
                          value={signatureName}
                          onChange={(e) => setSignatureName(e.target.value)}
                          placeholder="Authorized Signatory"
                        />
                        <Input
                          label="Designation"
                          value={signatureDesignation}
                          onChange={(e) => setSignatureDesignation(e.target.value)}
                          placeholder="Director / Finance Head"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-4 border-t border-gray-100">
                      <Button type="submit">Save invoice setup</Button>
                    </div>
                  </form>
                </CardBody>
              </Card>
            </div>
          )}

          {/* TAB 5: USER CONTROLS */}
          {activeTab === "user-controls" && isAdmin && (
            <div className="space-y-6">
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <CardTitle>User Access Controls</CardTitle>
                    <p className="text-xs text-gray-400">Activate users and tune granular permissions without changing their role.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void loadUserControls()} disabled={loadingUserControls}>
                    Refresh Users
                  </Button>
                </CardHeader>
                <CardBody className="p-0">
                  {loadingUserControls ? (
                    <div className="py-12 text-center text-sm text-gray-500">Loading users...</div>
                  ) : managedUsers.length === 0 ? (
                    <EmptyState title="No users found" description="Invite users before configuring access controls." />
                  ) : (
                    <Table>
                      <TableHead>
                        <TableRow>
                          {["Name", "Email", "Role", "Status", "Permissions", ""].map((header) => (
                            <TableHeaderCell key={header}>{header}</TableHeaderCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {managedUsers.map((user) => (
                          <Fragment key={user.id}>
                            <TableRow key={user.id} className="cursor-pointer" onClick={() => setExpandedUserId((prev) => prev === user.id ? null : user.id)}>
                              <TableCell className="font-medium text-gray-900">{user.name}</TableCell>
                              <TableCell>{user.email}</TableCell>
                              <TableCell>
                                <Badge className={cn("capitalize", getRoleBadgeClass(user.role))}>{user.role}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge className={cn(user.isActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700")}>
                                  {user.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell>{getPermissionCount(user.id)} granted</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  type="button"
                                  variant={user.isActive ? "danger" : "secondary"}
                                  size="sm"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleToggleManagedUser(user);
                                  }}
                                  disabled={updatingUserId === user.id || user.id === profile.id}
                                >
                                  {user.isActive ? "Deactivate" : "Activate"}
                                </Button>
                              </TableCell>
                            </TableRow>
                            {expandedUserId === user.id && (
                              <TableRow key={`${user.id}-permissions`}>
                                <TableCell colSpan={6} className="bg-gray-50/40">
                                  <div className="grid gap-5 md:grid-cols-2">
                                    {permissionCategories.map((category) => (
                                      <div key={category} className="rounded-lg border border-gray-200 bg-white p-4">
                                        <h3 className="text-sm font-semibold text-gray-900">{titleCase(category)}</h3>
                                        <div className="mt-3 space-y-3">
                                          {USER_PERMISSIONS.filter((permission) => permission.category === category).map((permission) => {
                                            const isGranted = getPermissionGranted(user.id, permission.key);
                                            const savingKey = `${user.id}:${permission.key}`;
                                            return (
                                              <div key={permission.key} className="flex items-start justify-between gap-4 border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                                                <div>
                                                  <p className="text-sm font-medium text-gray-800">{permission.label}</p>
                                                  <p className="text-xs text-gray-400">{permission.description}</p>
                                                </div>
                                                <button
                                                  type="button"
                                                  disabled={savingPermission === savingKey}
                                                  onClick={() => void handleToggleUserPermission(user.id, permission.key, !isGranted)}
                                                  className={cn(
                                                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60",
                                                    isGranted ? "bg-blue-600" : "bg-gray-200"
                                                  )}
                                                >
                                                  <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", isGranted ? "translate-x-5" : "translate-x-0")} />
                                                </button>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </div>
          )}

          {/* TAB 4: WORKSPACE SETTINGS */}
          {activeTab === "workspace" && isManagement && (
            <div className="space-y-6">
              {/* Mock Webhook settings */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Developer Webhook Configuration</CardTitle>
                  <p className="text-xs text-gray-400">Verify client payment completions securely using signature hashes.</p>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <p className="text-sm text-gray-500 leading-relaxed">
                    The payment server uses your exclusive webhook signing secret to confirm payouts from third-party channels.
                    Store it securely.
                  </p>
                  <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="space-y-1">
                        <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                          Webhook Signing Secret
                        </span>
                        <code className="mt-1 block font-mono text-sm text-gray-800 break-all select-all">
                          {revealWebhook ? webhookSecret : "••••••••••••••••••••••••••••••••"}
                        </code>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setRevealWebhook((r) => !r)}
                        >
                          {revealWebhook ? "Hide" : "Reveal"}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCopyWebhook}
                          className="flex items-center gap-1.5"
                        >
                          {copied ? (
                            <Icon name="check" className="text-emerald-600" />
                          ) : (
                            <Icon name="copy" />
                          )}
                          {copied ? "Copied" : "Copy"}
                        </Button>
                        {profile.role === "admin" && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowRegenerateConfirm(true)}
                          >
                            Regenerate
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>

              {/* Activity Trail / Audit logs */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <CardTitle>Workspace Security Log</CardTitle>
                    <p className="text-xs text-gray-400">Append-only audit trail of core operational actions.</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => void loadAuditData(auditPage)} disabled={loadingAudit}>
                    <Icon name="refresh" className={cn("size-3.5 mr-1.5", loadingAudit && "animate-spin")} />
                    Refresh Logs
                  </Button>
                </CardHeader>
                <CardBody className="p-0">
                  {loadingAudit ? (
                    <div className="py-12 flex justify-center items-center">
                      <span className="size-8 border-4 border-blue-600/20 border-t-blue-600 rounded-full animate-spin" />
                    </div>
                  ) : auditLogsData.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400">No recent security events recorded.</div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      <Table>
                        <TableHead>
                          <TableRow>
                            <TableHeaderCell className="pl-6">Event Action</TableHeaderCell>
                            <TableHeaderCell>Actor</TableHeaderCell>
                            <TableHeaderCell>Target Context</TableHeaderCell>
                            <TableHeaderCell className="pr-6">Timestamp</TableHeaderCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {auditLogsData.map((log) => (
                            <TableRow key={log.id}>
                              <TableCell className="pl-6 font-medium text-gray-900">
                                <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold", getActionBadgeClass(log.action))}>
                                  {humanizeAction(log.action)}
                                </span>
                              </TableCell>
                              <TableCell className="text-gray-600 font-medium">
                                {getActorName(log.actorUserId)}
                              </TableCell>
                              <TableCell className="text-xs font-mono text-gray-400 max-w-[180px] truncate">
                                {log.entityType.toUpperCase()}:{log.entityId ? log.entityId.slice(0, 8) : "SYSTEM"}
                              </TableCell>
                              <TableCell className="pr-6 text-gray-500 text-xs whitespace-nowrap">
                                {formatDate(log.createdAt, dateFormat)} {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>

                      {/* Pagination Controls */}
                      {auditTotal > auditLimit && (
                        <div className="px-6 py-4 flex items-center justify-between border-t border-gray-100 bg-gray-50/50">
                          <span className="text-xs text-gray-500">
                            Showing {(auditPage - 1) * auditLimit + 1} - {Math.min(auditPage * auditLimit, auditTotal)} of {auditTotal} logs
                          </span>
                          <div className="flex gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={auditPage === 1 || loadingAudit}
                              onClick={() => setAuditPage((p) => Math.max(p - 1, 1))}
                            >
                              Previous
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={auditPage * auditLimit >= auditTotal || loadingAudit}
                              onClick={() => setAuditPage((p) => p + 1)}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Custom profile field definitions — admin adds/removes fields at runtime */}
              <UserFieldManager />

              {/* System Metadata Info */}
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>Workspace Metadata</CardTitle>
                  <p className="text-xs text-gray-400">Technical configurations for support diagnostics.</p>
                </CardHeader>
                <CardBody className="p-5">
                  <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                    {[
                      ["Database Adapter Connection", "Neon Serverless Connection (Drizzle ORM)"],
                      ["File Cloud Asset Store", "Cloudinary Hosting CDN (2MB Limit)"],
                      ["API Rate Limiter Engine", "In-Memory Map Cache Limiters"],
                      ["User Auth Token Lease", "8 Hours (Jose Signed jwtVerify JWT)"],
                    ].map(([label, value]) => (
                      <div key={label} className="border-b border-gray-100 pb-2.5 last:border-b-0 sm:last:border-b">
                        <dt className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          {label}
                        </dt>
                        <dd className="mt-1 font-medium text-gray-700">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog for webhook secret regeneration */}
      {showRegenerateConfirm && (
        <ConfirmDialog
          title="Regenerate Webhook Secret"
          message="Are you absolutely sure you want to regenerate the webhook signing secret? Any active endpoints using the old key will fail validation immediately."
          confirmLabel="Regenerate Key"
          loading={regeneratingWebhook}
          onConfirm={handleRegenerateWebhook}
          onCancel={() => setShowRegenerateConfirm(false)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
