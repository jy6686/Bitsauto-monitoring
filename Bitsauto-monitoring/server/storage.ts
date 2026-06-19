
import { 
  calls, metrics, alerts, settings, userRoles, clientProfiles, userConfig,
  switches, fasEvents, fasVendorSettings, callSnapshots, monitoringAssignments, outageLog, alertRules,
  monitoredHosts, hostOutageLog, kams, kamAccounts, trafficAlerts, sippySnapshots,
  sippyChangeEvents,
  watcherRecipients, irsfEvents, blacklistRules, rateCards, rateCardEntries, mosHourly,
  apiKeys, dashboardWidgetPrefs, callTestLogs, whatsappAlertLog,
  simboxScores, billingDisputes, slaBreachLog, testCampaigns, testCampaignResults, syntheticTestRuns,
  routeDecisionTraces, carrierQualityScores, executionHealthLog, scheduledReports,
  chatRooms, chatMessages,
  productDocs,
  approvalRequests, approvalAuditLog,
  entityPresenceRegistry,
  concurrentSnapshots,
  portalAccessTokens,
  portalTickets, portalTicketMessages,
  rbacPermissions, rbacRolePermissions, rbacUserPermissionOverrides, rbacPermissionAuditEvents,
  type RbacPermission, type RbacRolePermission, type RbacUserPermissionOverride, type RbacPermissionAuditEvent,
  type PortalTicket, type InsertPortalTicket,
  type PortalTicketMessage, type InsertPortalTicketMessage,
  type ConsoleIncident, type IncidentLifecycleEvent,
  dataRetentionPolicy, deletionRequests,
  type DataRetentionPolicy, type DeletionRequest, type InsertDeletionRequest,
  type PortalToken, type InsertPortalToken,
  type Call, type InsertCall, type InsertMetric, 
  type Alert, type InsertAlert, type Settings, type InsertSettings,
  type UpdateSettingsRequest, type DashboardStats, type CallWithLatestMetric,
  type AsrAcdReportRow, type AsrAcdReportFilters,
  type Role, type ClientProfile, type InsertClientProfile,
  type UserConfig, type InsertUserConfig,
  type Switch, type InsertSwitch,
  type FasEvent, type InsertFasEvent, type FasVendorSetting, type InsertFasVendorSetting,
  type CallSnapshot, type InsertCallSnapshot,
  type OutageEntry, type InsertOutageEntry,
  type AlertRule, type InsertAlertRule,
  type MonitoredHost, type InsertMonitoredHost,
  type HostOutageEntry, type InsertHostOutageEntry,
  type Kam, type InsertKam,
  type KamAccount, type InsertKamAccount,
  type TrafficAlert, type InsertTrafficAlert,
  type WatcherRecipient, type InsertWatcherRecipient,
  type SippyChangeEvent, type InsertSippyChangeEvent,
  type IrsfEvent, type InsertIrsfEvent,
  type BlacklistRule, type InsertBlacklistRule,
  type RateCard, type InsertRateCard,
  type RateCardEntry, type InsertRateCardEntry,
  type MosHourly,
  type ApiKey,
  type DashboardWidgetPrefs,
  type CallTestLog, type InsertCallTestLog,
  type WhatsappAlertLog,
  fixHistory,
  type FixHistory, type InsertFixHistory,
  type SimboxScore, type InsertSimboxScore,
  type BillingDispute, type InsertBillingDispute,
  type SlaBreachEntry, type InsertSlaBreachEntry,
  type TestCampaign, type InsertTestCampaign,
  type TestCampaignResult, type InsertTestCampaignResult,
  type SyntheticTestRun, type InsertSyntheticTestRun,
  type RouteDecisionTrace, type InsertRouteDecisionTrace,
  type CarrierQualityScore, type InsertCarrierQualityScore,
  type ExecutionHealthEntry, type InsertExecutionHealthEntry,
  type ScheduledReport, type InsertScheduledReport,
  type ChatRoom, type InsertChatRoom,
  type ChatMessage, type InsertChatMessage,
  type ProductDoc, type InsertProductDoc,
  type ApprovalRequest, type InsertApprovalRequest, type ApprovalAuditEntry,
  type Company, type InsertCompany,
  type CompanyContact, type InsertCompanyContact,
  type CompanyBankAccount, type InsertCompanyBankAccount,
  type ClientIpRequest, type InsertClientIpRequest,
  type AccountConfig,
  companies, companyContacts, companyBankAccounts, clientIpRequests, accountConfigs,
  consoleIncidents, incidentLifecycleEvents,
  commercialNotifications, commercialNotificationRecipients,
  type CommercialNotification, type InsertCommercialNotification,
  type CommercialNotificationRecipient, type InsertCommercialNotificationRecipient,
  smtpSenderProfiles,
  type SmtpSenderProfile, type InsertSmtpSenderProfile,
  tariffVersions, tariffChangeEvents,
  type TariffVersion, type InsertTariffVersion,
  type TariffChangeEvent, type InsertTariffChangeEvent,
  ratingVerifications,
  type RatingVerification, type InsertRatingVerification,
  invoiceCdrSnapshots,
  type InvoiceCdrSnapshot, type InsertInvoiceCdrSnapshot,
  dailyMinutesReports,
  type DailyMinutesReport, type InsertDailyMinutesReport,
  clientIdentityMap,
  type ClientIdentity, type InsertClientIdentity,
  partnerProfiles,
  type PartnerProfile, type InsertPartnerProfile,
  aiRevenueAlerts,
  type AiRevenueAlert, type InsertAiRevenueAlert,
  aiScanRuns,
  type AiScanRun, type InsertAiScanRun,
  adjustmentLedger,
  type AdjustmentLedgerEntry, type InsertAdjustmentLedgerEntry,
  invoiceTemplates,
  type InvoiceTemplate, type InsertInvoiceTemplate,
  clientBrandingProfiles,
  type ClientBrandingProfile, type InsertClientBrandingProfile,
  creditNotes,
  type CreditNote, type InsertCreditNote,
  creditControlRules,
  type CreditControlRule, type InsertCreditControlRule,
  collectionEvents,
  type CollectionEvent, type InsertCollectionEvent,
  invoiceJobs,
  type InvoiceJob, type InsertInvoiceJob,
  disputeCases,
  type DisputeCase, type InsertDisputeCase,
  disputeCaseEvents,
  type DisputeCaseEvent, type InsertDisputeCaseEvent,
  marginAnalyticsDaily,
  type MarginAnalyticsDaily, type InsertMarginAnalyticsDaily,
  marginAlerts,
  type MarginAlert, type InsertMarginAlert,
  clientRevenueReconciliations,
  type ClientRevenueReconciliation, type InsertClientRevenueReconciliation,
  communicationPolicies,
  type CommunicationPolicy, type InsertCommunicationPolicy,
  reportJobs,
  type ReportJob, type InsertReportJob,
  invoices, invoiceLineItems, invoiceEmailDeliveries,
  type Invoice, type InsertInvoice,
  type InvoiceLineItem, type InsertInvoiceLineItem,
  type InvoiceEmailDelivery, type InsertInvoiceEmailDelivery,
  carrierReconciliations,
  type CarrierReconciliation, type InsertCarrierReconciliation,
  payments, type Payment, type InsertPayment,
  invoiceSchedules, type InvoiceSchedule, type InsertInvoiceSchedule,
  paymentReminderConfig, type PaymentReminderConfig,
  cdrRerateRuns, type CdrRerateRun, type InsertCdrRerateRun,
  reconciliationEmailLog, type ReconciliationEmailLog, type InsertReconciliationEmailLog,
  portalDefinitions, navigationModules, portalModuleAssignments, portalSections,
  userFavorites,
  type PortalDefinition, type InsertPortalModuleAssignment,
  type PortalModuleAssignment, type PortalModuleWithMeta, type PortalSection,
  type NavigationModule, type UserFavorite,
  workspaceDefinitions, workspaceTabs, workspaceTabItems,
  type WorkspaceDefinition, type WorkspaceTab, type WorkspaceTabItem,
  type WorkspaceTabWithItems, type WorkspaceWithTabs,
  reconciliationReportSchedules,
  type ReconciliationReportSchedule, type InsertReconciliationReportSchedule,
  ipSharingApprovals, type IpSharingApproval,
} from "@shared/schema";
import { users, type User } from "@shared/models/auth";
import { db, pool } from "./db";
import { eq, desc, asc, and, sql, gte, lt, inArray } from "drizzle-orm";

export interface IStorage {
  // Calls
  getCalls(limit?: number): Promise<CallWithLatestMetric[]>;
  getCall(id: number): Promise<Call | undefined>;
  createCall(call: InsertCall): Promise<Call>;
  endCall(id: number, status?: 'completed' | 'failed', failReason?: string): Promise<void>;
  
  // Metrics
  getMetricsForCall(callId: number): Promise<Metric[]>; // Returns last 50 metrics
  createMetric(metric: InsertMetric): Promise<Metric>;
  
  // Alerts
  getAlerts(): Promise<Alert[]>;
  getAlertsInRange(from: Date, to: Date): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  acknowledgeAlert(id: number, userId: string): Promise<Alert | null>;
  resolveAlert(id: number): Promise<Alert | null>;
  
  // Settings
  getSettings(): Promise<Settings>;
  getSippySettings(): Promise<Settings>;   // alias of getSettings(); used by Sippy routes
  updateSettings(settings: UpdateSettingsRequest): Promise<Settings>;
  
  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

  // Reports
  getAsrAcdReport(filters: AsrAcdReportFilters): Promise<AsrAcdReportRow[]>;

  // Team / Roles
  getUserRole(userId: string): Promise<Role | null>;
  getUserRoleRecord(userId: string): Promise<{ role: Role; teamId: string | null } | null>;
  setUserRole(userId: string, role: Role, assignedBy?: string, teamId?: string | null): Promise<void>;
  getAllUsersWithRoles(): Promise<Array<User & { role: Role; teamId: string | null }>>;
  countRoleEntries(): Promise<number>;

  // RBAC Matrix
  getRbacPermissions(): Promise<RbacPermission[]>;
  getRbacRolePermissions(role?: string): Promise<RbacRolePermission[]>;
  setRbacRolePermission(role: string, permissionKey: string, granted: boolean, actorId?: string): Promise<void>;
  getRbacUserOverrides(userId?: string): Promise<RbacUserPermissionOverride[]>;
  deleteRbacUserOverride(id: number): Promise<void>;
  getRbacAuditLog(limit?: number): Promise<RbacPermissionAuditEvent[]>;

  // Client & Vendor Profiles
  getClientProfiles(): Promise<ClientProfile[]>;
  createClientProfile(profile: InsertClientProfile): Promise<ClientProfile>;
  updateClientProfile(id: number, profile: Partial<InsertClientProfile>): Promise<ClientProfile>;
  deleteClientProfile(id: number): Promise<void>;

  // Switches
  getSwitches(): Promise<Switch[]>;
  createSwitch(sw: InsertSwitch): Promise<Switch>;
  updateSwitch(id: number, updates: Partial<InsertSwitch>): Promise<Switch>;
  deleteSwitch(id: number): Promise<void>;

  // User Configuration
  getUserConfig(userId: string): Promise<UserConfig | null>;
  upsertUserConfig(userId: string, config: Partial<InsertUserConfig>): Promise<UserConfig>;

  // FAS Events
  getFasEvents(limit?: number, vendor?: string): Promise<FasEvent[]>;
  createFasEvent(event: InsertFasEvent): Promise<FasEvent>;
  markFasAlertSent(id: number): Promise<void>;
  backfillFasEventVendors(vendorName: string): Promise<number>;

  // FAS Vendor Settings
  listFasVendorSettings(): Promise<FasVendorSetting[]>;
  getFasVendorSetting(vendor: string): Promise<FasVendorSetting | null>;
  upsertFasVendorSetting(vendor: string, data: Partial<InsertFasVendorSetting>): Promise<FasVendorSetting>;
  deleteFasVendorSetting(vendor: string): Promise<void>;

  // Call Snapshots (24-hour live call history)
  upsertCallSnapshot(snapshot: InsertCallSnapshot): Promise<void>;
  getCallHistory(hoursBack?: number): Promise<CallSnapshot[]>;
  cleanupOldSnapshots(): Promise<void>;

  // Monitoring Assignments
  getAllMonitoringAssignments(): Promise<Record<string, string[]>>;
  setMonitoringAssignments(userId: string, items: string[], assignedBy?: string): Promise<void>;

  // Monitored Hosts (multi-IP monitoring)
  getMonitoredHosts(): Promise<MonitoredHost[]>;
  createMonitoredHost(host: InsertMonitoredHost): Promise<MonitoredHost>;
  updateMonitoredHost(id: number, updates: Partial<InsertMonitoredHost>): Promise<MonitoredHost>;
  deleteMonitoredHost(id: number): Promise<void>;

  // Host Outage Log
  getHostOutageLog(hostId?: number, limit?: number): Promise<HostOutageEntry[]>;
  createHostOutageEntry(entry: InsertHostOutageEntry): Promise<HostOutageEntry>;
  updateHostOutageEntry(id: number, updates: Partial<HostOutageEntry>): Promise<void>;

  // KAM Management
  getKams(): Promise<Kam[]>;
  getKam(id: number): Promise<Kam | undefined>;
  getKamByUserId(userId: string): Promise<Kam | undefined>;
  createKam(kam: InsertKam): Promise<Kam>;
  updateKam(id: number, updates: Partial<InsertKam>): Promise<Kam>;
  deleteKam(id: number): Promise<void>;
  // Org hierarchy helpers
  getKamSubtreeIds(kamId: number): Promise<number[]>;       // self + all subordinate KAM IDs
  getAccountsForSubtree(kamId: number): Promise<string[]>;  // all account IDs visible to this user

  // KAM Account Assignments
  getKamAccounts(kamId?: number): Promise<KamAccount[]>;
  createKamAccount(ka: InsertKamAccount): Promise<KamAccount>;
  updateKamAccount(id: number, patch: Partial<Pick<KamAccount, 'alertEmail' | 'clientName' | 'dropThreshold'>>): Promise<KamAccount>;
  deleteKamAccount(id: number): Promise<void>;

  // Traffic Alerts
  getTrafficAlerts(limit?: number): Promise<TrafficAlert[]>;
  createTrafficAlert(alert: InsertTrafficAlert): Promise<TrafficAlert>;
  updateTrafficAlert(id: number, updates: Partial<TrafficAlert>): Promise<void>;
  getOpenTrafficAlert(clientName: string): Promise<TrafficAlert | undefined>;

  // Sippy Snapshots (key-value store for change detection)
  getSippySnapshot(key: string): Promise<any | null>;
  setSippySnapshot(key: string, data: any): Promise<void>;
  recordSippyChangeEvents(events: InsertSippyChangeEvent[]): Promise<void>;
  listSippyChangeEvents(opts?: { category?: string; limit?: number }): Promise<SippyChangeEvent[]>;

  // Portal Governance
  getPortalDefinitions(): Promise<PortalDefinition[]>;
  getPortalModules(portalSlug: string): Promise<PortalModuleWithMeta[]>;
  getPortalSections(portalSlug: string): Promise<PortalSection[]>;
  upsertPortalModuleAssignment(data: Partial<InsertPortalModuleAssignment> & { portalId: string; moduleId: number }): Promise<PortalModuleAssignment>;
  removePortalModuleAssignment(portalId: string, moduleId: number): Promise<void>;
  resetPortalToDefaults(portalSlug: string): Promise<void>;
  // Governance Console
  getAllNavigationModules(): Promise<NavigationModule[]>;
  updatePortalDefinition(slug: string, data: { name?: string; icon?: string; theme?: string; isActive?: boolean; sortOrder?: number; defaultRoute?: string }): Promise<PortalDefinition>;
  createPortalSection(data: { portalId: string; sectionKey: string; title: string; icon?: string; sortOrder?: number }): Promise<PortalSection>;
  updatePortalSection(id: number, data: { title?: string; icon?: string; sortOrder?: number; isActive?: boolean }): Promise<PortalSection>;
  deletePortalSection(id: number): Promise<void>;
  reorderPortalSections(portalSlug: string, orderedIds: number[]): Promise<void>;
  updatePortalModuleAssignmentById(id: number, data: { section?: string; displayOrder?: number; displayLabel?: string; adapter?: string; visibility?: string; isPinned?: boolean }): Promise<PortalModuleAssignment>;
  reorderPortalModuleAssignments(portalId: string, sectionKey: string, orderedIds: number[]): Promise<void>;

  // Workspace Navigation Architecture
  getWorkspace(slug: string): Promise<WorkspaceWithTabs | null>;
  getWorkspaceForRoute(route: string): Promise<WorkspaceWithTabs | null>;
  listWorkspaces(): Promise<WorkspaceDefinition[]>;
  countWorkspaces(): Promise<number>;
  upsertWorkspaceDefinition(data: Omit<WorkspaceDefinition, 'id' | 'createdAt'>): Promise<WorkspaceDefinition>;
  insertWorkspaceTab(data: Omit<WorkspaceTab, 'id'>): Promise<WorkspaceTab>;
  insertWorkspaceTabItem(data: Omit<WorkspaceTabItem, 'id'>): Promise<WorkspaceTabItem>;
  updateWorkspaceTab(id: number, data: Partial<Pick<WorkspaceTab, 'label' | 'icon' | 'sortOrder' | 'isVisible' | 'visibilityRoles'>>): Promise<WorkspaceTab>;
  moveWorkspaceTabItem(itemId: number, newTabId: number, sortOrder?: number): Promise<WorkspaceTabItem>;
  reorderWorkspaceTabs(workspaceId: number, orderedIds: number[]): Promise<void>;

  // User Favorites
  getFavorites(userId: string): Promise<UserFavorite[]>;
  addFavorite(data: { userId: string; moduleKey: string; label?: string; icon?: string; route: string; portalKey?: string }): Promise<UserFavorite>;
  removeFavorite(userId: string, moduleKey: string): Promise<void>;
  reorderFavorites(userId: string, orderedIds: number[]): Promise<void>;

  // Watcher Recipients
  getWatcherRecipients(): Promise<WatcherRecipient[]>;
  addWatcherRecipient(data: InsertWatcherRecipient): Promise<WatcherRecipient>;
  updateWatcherRecipient(id: number, data: Partial<InsertWatcherRecipient>): Promise<WatcherRecipient | undefined>;
  deleteWatcherRecipient(id: number): Promise<void>;

  // IRSF Events
  getIrsfEvents(limit?: number): Promise<IrsfEvent[]>;
  createIrsfEvent(event: InsertIrsfEvent): Promise<IrsfEvent>;

  // Blacklist Rules
  getBlacklistRules(): Promise<BlacklistRule[]>;
  createBlacklistRule(rule: InsertBlacklistRule): Promise<BlacklistRule>;
  updateBlacklistRule(id: number, updates: Partial<InsertBlacklistRule>): Promise<BlacklistRule | undefined>;
  deleteBlacklistRule(id: number): Promise<void>;
  incrementBlacklistHit(id: number): Promise<void>;

  // Rate Cards
  getRateCards(): Promise<RateCard[]>;
  createRateCard(card: InsertRateCard): Promise<RateCard>;
  deleteRateCard(id: number): Promise<void>;
  getRateCardEntries(rateCardId: number): Promise<RateCardEntry[]>;
  bulkInsertRateCardEntries(entries: InsertRateCardEntry[]): Promise<number>;
  updateRateCardEntryCount(rateCardId: number, count: number): Promise<void>;
  lookupRateForPrefix(rateCardId: number, callee: string): Promise<RateCardEntry | null>;
  lcrAnalyse(number: string, clientRateCardId?: number): Promise<{
    vendorResults: { card: RateCard; entry: RateCardEntry }[];
    clientEntry: RateCardEntry | null;
  }>;

  // MOS Hourly Snapshots
  getMosHourly(hoursBack?: number, vendor?: string): Promise<MosHourly[]>;
  upsertMosHourly(hour: Date, vendor: string | null, avgMos: number, minMos: number, maxMos: number, callCount: number): Promise<void>;

  // API Keys (Tier 5 — #24)
  getApiKeys(userId: string): Promise<ApiKey[]>;
  createApiKey(data: { userId: string; name: string; keyHash: string; keyPrefix: string; permissions: string[] }): Promise<ApiKey>;
  revokeApiKey(id: number, userId: string): Promise<void>;
  validateApiKey(keyHash: string): Promise<ApiKey | null>;
  touchApiKey(id: number): Promise<void>;

  // Dashboard Widget Prefs (Tier 5 — #20)
  getDashboardWidgetPrefs(userId: string): Promise<DashboardWidgetPrefs | null>;
  setDashboardWidgetPrefs(userId: string, hiddenWidgets: string[], widgetOrder?: string[]): Promise<DashboardWidgetPrefs>;

  // Call Test Logs (Vol 2 — #16)
  logTestCall(data: InsertCallTestLog): Promise<CallTestLog>;
  getTestCallLogs(userId: string, limit?: number): Promise<CallTestLog[]>;

  // WhatsApp Alert Log
  logWhatsappAlert(data: { alertType: string; recipient: string; message: string; status: string; errorMsg?: string | null }): Promise<void>;
  getWhatsappAlertLogs(limit?: number): Promise<WhatsappAlertLog[]>;

  // Fix History — Phase 3
  addFixHistoryEntry(entry: InsertFixHistory): Promise<FixHistory>;
  getFixHistory(limit?: number): Promise<FixHistory[]>;
  getFixHistoryById(id: number): Promise<FixHistory | null>;
  findSimilarFix(issueType: string, component: string): Promise<FixHistory | null>;

  // SIMbox Scores
  getLatestSimboxScores(limit?: number): Promise<SimboxScore[]>;
  upsertSimboxScore(score: InsertSimboxScore): Promise<SimboxScore>;
  getSimboxScoresByVendor(vendorId: string, limit?: number): Promise<SimboxScore[]>;

  // Billing Disputes
  getBillingDisputes(): Promise<BillingDispute[]>;
  createBillingDispute(dispute: InsertBillingDispute): Promise<BillingDispute>;
  updateBillingDispute(id: number, updates: Partial<InsertBillingDispute>): Promise<BillingDispute | undefined>;
  deleteBillingDispute(id: number): Promise<void>;

  // SLA Breach Log
  getSlaBreaches(limit?: number, vendorId?: string): Promise<SlaBreachEntry[]>;
  addSlaBreachEntry(entry: InsertSlaBreachEntry): Promise<SlaBreachEntry>;
  resolveSlaBreachEntry(id: number, breachEnd: Date, durationMinutes: number): Promise<void>;
  getOpenSlaBreach(vendorId: string, metric: string): Promise<SlaBreachEntry | null>;

  // Test Campaigns
  getTestCampaigns(): Promise<TestCampaign[]>;
  getTestCampaign(id: number): Promise<TestCampaign | undefined>;
  createTestCampaign(campaign: InsertTestCampaign): Promise<TestCampaign>;
  updateTestCampaign(id: number, updates: Partial<InsertTestCampaign>): Promise<TestCampaign | undefined>;
  deleteTestCampaign(id: number): Promise<void>;
  addCampaignResult(result: InsertTestCampaignResult): Promise<TestCampaignResult>;
  getCampaignResults(campaignId: number, limit?: number): Promise<TestCampaignResult[]>;
  getCampaignsDueForRun(): Promise<TestCampaign[]>;
  getSyntheticTestRuns(campaignId: number, limit?: number): Promise<SyntheticTestRun[]>;
  addSyntheticTestRun(run: InsertSyntheticTestRun): Promise<SyntheticTestRun>;

  // Route Decision Traces
  addRouteDecisionTrace(trace: InsertRouteDecisionTrace): Promise<RouteDecisionTrace>;
  getRouteDecisionTraces(opts: { campaignId?: number; limit?: number }): Promise<RouteDecisionTrace[]>;

  // Carrier Quality Scores
  getCarrierQualityScores(windowHours?: number): Promise<CarrierQualityScore[]>;

  // Scheduled Reports
  getScheduledReports(): Promise<ScheduledReport[]>;
  createScheduledReport(report: InsertScheduledReport): Promise<ScheduledReport>;
  updateScheduledReport(id: number, updates: Partial<InsertScheduledReport>): Promise<ScheduledReport | undefined>;
  deleteScheduledReport(id: number): Promise<void>;
  markReportSent(id: number, sentAt: Date, nextDueAt: Date): Promise<void>;
  getDueScheduledReports(): Promise<ScheduledReport[]>;

  // Reconciliation Report Schedules
  getReconciliationReportSchedules(): Promise<ReconciliationReportSchedule[]>;
  createReconciliationReportSchedule(s: InsertReconciliationReportSchedule): Promise<ReconciliationReportSchedule>;
  updateReconciliationReportSchedule(id: number, updates: Partial<InsertReconciliationReportSchedule>): Promise<ReconciliationReportSchedule | undefined>;
  deleteReconciliationReportSchedule(id: number): Promise<void>;
  markReconciliationReportSent(id: number, sentAt: Date, nextDueAt: Date): Promise<void>;
  getDueReconciliationReportSchedules(): Promise<ReconciliationReportSchedule[]>;

  // Chat
  getChatRooms(): Promise<ChatRoom[]>;
  getChatRoom(slug: string): Promise<ChatRoom | undefined>;
  createChatRoom(room: InsertChatRoom): Promise<ChatRoom>;
  getChatMessages(roomId: number, limit?: number): Promise<ChatMessage[]>;
  createChatMessage(msg: InsertChatMessage): Promise<ChatMessage>;
  ensureDefaultChatRooms(): Promise<void>;

  // Product Documents
  getProductDocs(productPrefix?: string): Promise<ProductDoc[]>;
  getProductDoc(id: number): Promise<ProductDoc | undefined>;
  createProductDoc(doc: InsertProductDoc): Promise<ProductDoc>;
  updateProductDoc(id: number, patch: Partial<InsertProductDoc>): Promise<ProductDoc>;
  deleteProductDoc(id: number): Promise<void>;

  // Approval Workflow
  createApprovalRequest(data: InsertApprovalRequest): Promise<ApprovalRequest>;
  getApprovalRequests(opts: { userId: string; role: Role; teamId?: string | null; status?: string }): Promise<ApprovalRequest[]>;
  getApprovalRequestById(id: number): Promise<ApprovalRequest | null>;
  updateApprovalRequest(id: number, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest>;
  addApprovalAuditEntry(entry: Omit<ApprovalAuditEntry, 'id' | 'createdAt'>): Promise<void>;
  getApprovalAuditLog(requestId: number): Promise<ApprovalAuditEntry[]>;
  getPendingApprovalCount(opts: { userId: string; role: Role; teamId?: string | null }): Promise<number>;
  getUserTeamId(userId: string): Promise<string | null>;

  // Portal Access Tokens
  createPortalToken(data: InsertPortalToken): Promise<PortalToken>;
  listPortalTokens(): Promise<PortalToken[]>;
  getPortalToken(token: string): Promise<PortalToken | undefined>;
  deletePortalToken(id: number): Promise<void>;
  touchPortalToken(id: number): Promise<void>;

  // GDPR / Compliance
  getDeletionRequests(): Promise<DeletionRequest[]>;
  getDeletionRequest(id: number): Promise<DeletionRequest | null>;
  createDeletionRequest(req: InsertDeletionRequest): Promise<DeletionRequest>;
  updateDeletionRequest(id: number, updates: Partial<DeletionRequest>): Promise<DeletionRequest>;
  getDataRetentionPolicies(): Promise<DataRetentionPolicy[]>;
  updateDataRetentionPolicy(dataType: string, updates: Partial<DataRetentionPolicy>): Promise<void>;
  seedDefaultRetentionPolicies(): Promise<void>;

  // ── SMTP Sender Profiles ─────────────────────────────────────────────────────
  listSmtpSenderProfiles(): Promise<SmtpSenderProfile[]>;
  getSmtpSenderProfile(id: number): Promise<SmtpSenderProfile | null>;
  createSmtpSenderProfile(data: InsertSmtpSenderProfile): Promise<SmtpSenderProfile>;
  updateSmtpSenderProfile(id: number, updates: Partial<SmtpSenderProfile>): Promise<SmtpSenderProfile>;
  deleteSmtpSenderProfile(id: number): Promise<void>;

  // ── Daily Minutes Report (DMR) ─────────────────────────────────────────────
  listDMRReports(opts: { reportDate?: string; fromDate?: string; toDate?: string; latestVersionOnly?: boolean; status?: string }): Promise<DailyMinutesReport[]>;
  getDMRReport(id: number): Promise<DailyMinutesReport | null>;
  bulkInsertDMRReports(rows: InsertDailyMinutesReport[]): Promise<DailyMinutesReport[]>;
  updateDMRStatus(id: number, status: string): Promise<DailyMinutesReport | null>;
  // Governance: check if all days in a period have at least one 'verified' DMR row
  hasDMRVerifiedForPeriod(fromDate: string, toDate: string): Promise<{ verified: boolean; missingDates: string[]; criticalDates: string[] }>;

  // ── Client Identity Map ────────────────────────────────────────────────────
  listClientIdentities(opts?: { activeOnly?: boolean; search?: string }): Promise<ClientIdentity[]>;
  getClientIdentityByAccount(iAccount: number): Promise<ClientIdentity | null>;
  getClientIdentityById(id: number): Promise<ClientIdentity | null>;
  upsertClientIdentity(data: InsertClientIdentity): Promise<ClientIdentity>;
  updateClientIdentity(id: number, updates: Partial<InsertClientIdentity>): Promise<ClientIdentity>;
  deleteClientIdentity(id: number): Promise<void>;
  resolveClientIdentity(iAccount: number | null | undefined, fallbackUsername?: string): Promise<{ displayName: string; billingName: string; iAccount: number | null; sippyUsername: string | null; riskTier: string }>;

  // ── Partner Operations Portal ──────────────────────────────────────────────
  createPartnerProfile(data: Omit<InsertPartnerProfile, 'accessCodeHash' | 'accessCodePrefix'> & { accessCodeHash: string; accessCodePrefix: string }): Promise<PartnerProfile>;
  listPartnerProfiles(): Promise<PartnerProfile[]>;
  getPartnerProfileById(id: number): Promise<PartnerProfile | null>;
  getPartnerProfileByClientName(clientName: string): Promise<PartnerProfile | null>;
  findPartnerByCodePrefix(prefix: string): Promise<PartnerProfile[]>;
  updatePartnerProfile(id: number, updates: Partial<PartnerProfile>): Promise<PartnerProfile>;
  deletePartnerProfile(id: number): Promise<void>;

  // ── AI Revenue Assurance Layer ─────────────────────────────────────────────
  createAiAlert(data: InsertAiRevenueAlert): Promise<AiRevenueAlert>;
  listAiAlerts(opts?: { status?: string; severity?: string; alertType?: string; clientName?: string; limit?: number }): Promise<AiRevenueAlert[]>;
  updateAiAlert(id: number, updates: Partial<AiRevenueAlert>): Promise<AiRevenueAlert>;
  createScanRun(data: Partial<InsertAiScanRun>): Promise<AiScanRun>;
  listScanRuns(limit?: number): Promise<AiScanRun[]>;
  updateScanRun(id: number, updates: Partial<AiScanRun>): Promise<AiScanRun>;
  createLedgerEntry(data: InsertAdjustmentLedgerEntry): Promise<AdjustmentLedgerEntry>;
  listLedgerEntries(opts?: { clientName?: string; referenceType?: string; referenceId?: string; limit?: number }): Promise<AdjustmentLedgerEntry[]>;

  // ── Multi-Template Invoice Rendering ──────────────────────────────────────
  createInvoiceTemplate(data: InsertInvoiceTemplate): Promise<InvoiceTemplate>;
  getInvoiceTemplate(id: number): Promise<InvoiceTemplate | null>;
  listInvoiceTemplates(opts?: { clientName?: string; isDefault?: boolean; templateType?: string }): Promise<InvoiceTemplate[]>;
  updateInvoiceTemplate(id: number, updates: Partial<InvoiceTemplate>): Promise<InvoiceTemplate>;
  deleteInvoiceTemplate(id: number): Promise<void>;

  // ── Client Branding Profiles ───────────────────────────────────────────────
  createBrandingProfile(data: InsertClientBrandingProfile): Promise<ClientBrandingProfile>;
  getBrandingProfile(id: number): Promise<ClientBrandingProfile | null>;
  listBrandingProfiles(opts?: { clientName?: string; isGlobal?: boolean }): Promise<ClientBrandingProfile[]>;
  updateBrandingProfile(id: number, updates: Partial<ClientBrandingProfile>): Promise<ClientBrandingProfile>;
  deleteBrandingProfile(id: number): Promise<void>;

  // ── Credit Notes & Settlement Engine ──────────────────────────────────────
  createCreditNote(data: InsertCreditNote): Promise<CreditNote>;
  getCreditNote(id: number): Promise<CreditNote | null>;
  listCreditNotes(opts?: { status?: string; clientName?: string; year?: string }): Promise<CreditNote[]>;
  updateCreditNote(id: number, updates: Partial<CreditNote>): Promise<CreditNote>;

  // ── Collections & Credit Control ───────────────────────────────────────────
  createCreditControlRule(data: InsertCreditControlRule): Promise<CreditControlRule>;
  getCreditControlRuleByClient(clientName: string): Promise<CreditControlRule | null>;
  getGlobalCreditControlRule(): Promise<CreditControlRule | null>;
  listCreditControlRules(opts?: { isGlobal?: boolean }): Promise<CreditControlRule[]>;
  updateCreditControlRule(id: number, updates: Partial<CreditControlRule>): Promise<CreditControlRule>;
  createCollectionEvent(data: InsertCollectionEvent): Promise<CollectionEvent>;
  listCollectionEvents(opts?: { clientName?: string; eventType?: string; limit?: number }): Promise<CollectionEvent[]>;
  updateCollectionEvent(id: number, updates: Partial<CollectionEvent>): Promise<CollectionEvent>;

  // ── Invoice Delivery Automation ────────────────────────────────────────────
  createInvoiceJob(data: InsertInvoiceJob): Promise<InvoiceJob>;
  getInvoiceJob(id: number): Promise<InvoiceJob | null>;
  listInvoiceJobs(opts?: { status?: string; clientName?: string; billingPeriod?: string }): Promise<InvoiceJob[]>;
  updateInvoiceJob(id: number, updates: Partial<InvoiceJob>): Promise<InvoiceJob>;

  // ── Formal Dispute Workflow ────────────────────────────────────────────────
  createDisputeCase(data: InsertDisputeCase): Promise<DisputeCase>;
  getDisputeCase(id: number): Promise<DisputeCase | null>;
  listDisputeCases(opts?: { status?: string; clientName?: string; severity?: string; year?: string }): Promise<DisputeCase[]>;
  updateDisputeCase(id: number, updates: Partial<DisputeCase>): Promise<DisputeCase>;
  addDisputeCaseEvent(data: InsertDisputeCaseEvent): Promise<DisputeCaseEvent>;
  listDisputeCaseEvents(caseId: number): Promise<DisputeCaseEvent[]>;

  // ── Margin Intelligence ────────────────────────────────────────────────────
  deleteMarginAnalyticsForDate(date: string): Promise<void>;
  bulkInsertMarginAnalytics(rows: InsertMarginAnalyticsDaily[]): Promise<MarginAnalyticsDaily[]>;
  getMarginAnalytics(opts: { date?: string; fromDate?: string; toDate?: string; dimensionType?: string; dimensionName?: string }): Promise<MarginAnalyticsDaily[]>;
  bulkInsertMarginAlerts(alerts: InsertMarginAlert[]): Promise<MarginAlert[]>;
  listMarginAlerts(opts: { unacknowledged?: boolean; date?: string; severity?: string }): Promise<MarginAlert[]>;
  updateMarginAlert(id: number, updates: Partial<MarginAlert>): Promise<MarginAlert>;

  // ── Acknowledgement Tracking ───────────────────────────────────────────────
  findRecipientByToken(token: string): Promise<CommercialNotificationRecipient | null>;
  updateRecipientByToken(token: string, updates: Partial<CommercialNotificationRecipient>): Promise<void>;

  // ── Client Revenue Reconciliation ─────────────────────────────────────────
  listClientReconciliations(opts: { billingPeriod?: string; clientAccountId?: string; status?: string; severity?: string; latestVersionOnly?: boolean }): Promise<ClientRevenueReconciliation[]>;
  getClientReconciliation(id: number): Promise<ClientRevenueReconciliation | null>;
  createClientReconciliation(data: InsertClientRevenueReconciliation): Promise<ClientRevenueReconciliation>;
  updateClientReconciliation(id: number, updates: Partial<ClientRevenueReconciliation>): Promise<ClientRevenueReconciliation>;

  // ── Communication Policies Engine ─────────────────────────────────────────
  listCommunicationPolicies(opts: { enabled?: boolean; triggerType?: string }): Promise<CommunicationPolicy[]>;
  getCommunicationPolicy(id: number): Promise<CommunicationPolicy | null>;
  createCommunicationPolicy(data: InsertCommunicationPolicy): Promise<CommunicationPolicy>;
  updateCommunicationPolicy(id: number, updates: Partial<CommunicationPolicy>): Promise<CommunicationPolicy>;
  deleteCommunicationPolicy(id: number): Promise<void>;

  // ── Layer 5A — Executive Report Jobs ──────────────────────────────────────
  createReportJob(data: InsertReportJob): Promise<ReportJob>;
  getReportJob(id: number): Promise<ReportJob | null>;
  listReportJobs(opts?: { limit?: number }): Promise<ReportJob[]>;
  updateReportJob(id: number, updates: Partial<ReportJob>): Promise<ReportJob>;

  // ── Layer 5B — Invoices ────────────────────────────────────────────────────
  createInvoice(data: InsertInvoice): Promise<Invoice>;
  getInvoice(id: number): Promise<Invoice | null>;
  listInvoices(opts?: { status?: string; iTariff?: string; limit?: number }): Promise<Invoice[]>;
  updateInvoice(id: number, updates: Partial<Invoice>): Promise<Invoice>;
  countInvoices(): Promise<number>;
  bulkCreateInvoiceLineItems(items: InsertInvoiceLineItem[]): Promise<void>;
  listInvoiceLineItems(invoiceId: number): Promise<InvoiceLineItem[]>;
  // Invoice email deliveries
  createInvoiceEmailDelivery(data: InsertInvoiceEmailDelivery): Promise<InvoiceEmailDelivery>;
  listInvoiceEmailDeliveries(invoiceId: number): Promise<InvoiceEmailDelivery[]>;

  // ── Layer 5C — Carrier Reconciliation ─────────────────────────────────────
  createCarrierReconciliation(data: InsertCarrierReconciliation): Promise<CarrierReconciliation>;
  getCarrierReconciliation(id: number): Promise<CarrierReconciliation | null>;
  listCarrierReconciliations(opts?: { status?: string; iTariff?: string; limit?: number }): Promise<CarrierReconciliation[]>;
  updateCarrierReconciliation(id: number, updates: Partial<CarrierReconciliation>): Promise<CarrierReconciliation>;

  // ── Immutable Rating Snapshots (Layer 4C) ─────────────────────────────────
  createInvoiceCdrSnapshot(data: InsertInvoiceCdrSnapshot): Promise<InvoiceCdrSnapshot>;
  getInvoiceCdrSnapshot(id: number): Promise<InvoiceCdrSnapshot | null>;
  getInvoiceCdrSnapshotByCdrId(cdrId: string): Promise<InvoiceCdrSnapshot | null>;
  listInvoiceCdrSnapshots(opts?: {
    iTariff?:            string;
    verificationStatus?: string;
    since?:              Date;
    limit?:              number;
  }): Promise<InvoiceCdrSnapshot[]>;
  bulkCreateInvoiceCdrSnapshots(rows: InsertInvoiceCdrSnapshot[]): Promise<number>;
  getExistingCdrIdsForTariff(iTariff: string): Promise<Set<string>>;

  // ── Rating Verification (Layer 4B) ────────────────────────────────────────
  createRatingVerification(data: InsertRatingVerification): Promise<RatingVerification>;
  getRatingVerification(id: number): Promise<RatingVerification | null>;
  listRatingVerifications(opts?: {
    iTariff?: string;
    discrepancyType?: string;
    severity?: string;
    verificationStatus?: string;
    since?: Date;
    limit?: number;
  }): Promise<RatingVerification[]>;
  updateRatingVerificationStatus(id: number, status: string, notes?: string): Promise<RatingVerification>;

  // ── Tariff Versioning (Layer 4A) ───────────────────────────────────────────
  createTariffVersion(data: InsertTariffVersion): Promise<TariffVersion>;
  getTariffVersion(id: number): Promise<TariffVersion | null>;
  listTariffVersions(iTariff?: string): Promise<TariffVersion[]>;
  getLatestTariffVersion(iTariff: string): Promise<TariffVersion | null>;
  listTariffChangeEvents(tariffVersionId: number): Promise<TariffChangeEvent[]>;
  bulkCreateTariffChangeEvents(rows: InsertTariffChangeEvent[]): Promise<TariffChangeEvent[]>;

  // ── Commercial Notifications ─────────────────────────────────────────────────
  listCommercialNotifications(): Promise<CommercialNotification[]>;
  getCommercialNotification(id: number): Promise<CommercialNotification | null>;
  createCommercialNotification(data: InsertCommercialNotification): Promise<CommercialNotification>;
  updateCommercialNotification(id: number, updates: Partial<CommercialNotification>): Promise<CommercialNotification>;
  deleteCommercialNotification(id: number): Promise<void>;
  getCommercialNotificationRecipients(notificationId: number): Promise<CommercialNotificationRecipient[]>;
  bulkInsertCommercialNotificationRecipients(rows: InsertCommercialNotificationRecipient[]): Promise<void>;
  updateCommercialNotificationRecipient(id: number, updates: Partial<CommercialNotificationRecipient>): Promise<void>;

  // ── Account Management — Companies ─────────────────────────────────────────
  getCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | null>;
  getCompanyBySippyAccount(iAccount: number): Promise<Company | null>;
  createCompany(data: InsertCompany, contacts: any[], bankAccounts: any[]): Promise<Company>;
  updateCompany(id: number, updates: Partial<Company>): Promise<Company>;
  deleteCompany(id: number): Promise<void>;

  // ── Account Management — Client IP Requests ─────────────────────────────────
  getClientIpRequests(companyId?: number): Promise<ClientIpRequest[]>;
  findClientIpRequest(ipAddress: string, clientName: string): Promise<ClientIpRequest | null>;

  // ── Per-account local config ──────────────────────────────────────────────────
  getAccountConfig(iAccount: number): Promise<Record<string, any>>;
  saveAccountConfig(iAccount: number, section: string, data: Record<string, any>): Promise<void>;
  createClientIpRequest(data: InsertClientIpRequest): Promise<ClientIpRequest>;
  updateClientIpRequest(id: number, updates: Partial<ClientIpRequest>): Promise<ClientIpRequest>;

  // ── Portal Ticket System (V1.1) ───────────────────────────────────────────
  listPortalTickets(filter?: { accountId?: number; status?: string }): Promise<PortalTicket[]>;
  getPortalTicket(id: number): Promise<PortalTicket | null>;
  createPortalTicket(data: InsertPortalTicket): Promise<PortalTicket>;
  updatePortalTicketStatus(id: number, status: string): Promise<PortalTicket>;
  listTicketMessages(ticketId: number): Promise<PortalTicketMessage[]>;
  addTicketMessage(data: InsertPortalTicketMessage): Promise<PortalTicketMessage>;

  // ── Console Incidents (Phase 2) ────────────────────────────────────────────
  upsertConsoleIncident(data: {
    entityKey: string; entityLabel: string; windowHash: string;
    severity: string; title: string; alertsJson: string;
    estimatedImpactPerHr: number | null; linkedTicketId: number | null;
    startedAt: Date; lastSeenAt: Date;
  }): Promise<ConsoleIncident>;
  listConsoleIncidents(): Promise<ConsoleIncident[]>;
  getConsoleIncident(id: number): Promise<ConsoleIncident | null>;
  updateConsoleIncidentState(id: number, state: string, resolvedAt?: Date | null): Promise<ConsoleIncident>;
  updateConsoleIncidentFields(id: number, fields: Partial<ConsoleIncident>): Promise<ConsoleIncident>;
  addLifecycleEvent(data: { incidentId: number; fromState: string | null; toState: string; actor?: string; note?: string }): Promise<IncidentLifecycleEvent>;
  listLifecycleEvents(incidentId: number): Promise<IncidentLifecycleEvent[]>;

  // ── Entity Presence Registry ──────────────────────────────────────────────────
  loadEntityPresence(): Promise<{ dim: string; entityName: string; lastSeen: number; firstSeen: number; peakToday: number; peakTs: number }[]>;
  upsertEntityPresence(rows: { dim: string; entityName: string; lastSeen: number; firstSeen: number; peakToday: number; peakTs: number }[]): Promise<void>;

  // Concurrent Snapshot History
  insertConcurrentSnapshots(rows: { dim: string; entityName: string; ts: number; active: number; connected: number; routing: number }[]): Promise<void>;
  queryConcurrentHistory(dim: string, entityName: string, fromTs: number, bucketMs: number): Promise<{ bucketTs: number; maxActive: number; avgActive: number; maxConnected: number; maxRouting: number }[]>;
  pruneConcurrentSnapshots(): Promise<void>;

  // ── Payments ──────────────────────────────────────────────────────────────
  createPayment(data: InsertPayment): Promise<Payment>;
  listPayments(opts?: { companyId?: number; status?: string; limit?: number }): Promise<Payment[]>;
  getPayment(id: number): Promise<Payment | null>;
  updatePayment(id: number, updates: Partial<Payment>): Promise<Payment>;
  deletePayment(id: number): Promise<void>;

  // ── Invoice Schedules ──────────────────────────────────────────────────────
  createInvoiceSchedule(data: InsertInvoiceSchedule): Promise<InvoiceSchedule>;
  listInvoiceSchedules(): Promise<InvoiceSchedule[]>;
  getInvoiceSchedule(id: number): Promise<InvoiceSchedule | null>;
  updateInvoiceSchedule(id: number, updates: Partial<InvoiceSchedule>): Promise<InvoiceSchedule>;
  deleteInvoiceSchedule(id: number): Promise<void>;

  // ── Payment Reminder Config ────────────────────────────────────────────────
  getPaymentReminderConfig(): Promise<PaymentReminderConfig | null>;
  upsertPaymentReminderConfig(data: Partial<PaymentReminderConfig>): Promise<PaymentReminderConfig>;

  // ── CDR Re-rating ──────────────────────────────────────────────────────────
  createCdrRerateRun(data: InsertCdrRerateRun): Promise<CdrRerateRun>;
  listCdrRerateRuns(): Promise<CdrRerateRun[]>;
  getCdrRerateRun(id: number): Promise<CdrRerateRun | null>;
  updateCdrRerateRun(id: number, updates: Partial<CdrRerateRun>): Promise<CdrRerateRun>;
  deleteCdrRerateRun(id: number): Promise<void>;

  // ── Reconciliation Email Audit Log ─────────────────────────────────────────
  logReconciliationEmail(data: InsertReconciliationEmailLog): Promise<ReconciliationEmailLog>;
  listReconciliationEmailLogs(limit?: number): Promise<ReconciliationEmailLog[]>;

  // ── Duplicate IP Sharing Approvals ─────────────────────────────────────────
  getIpSharingApprovals(status?: string): Promise<IpSharingApproval[]>;
  getIpSharingApprovalByIp(ipAddress: string): Promise<IpSharingApproval | undefined>;
  upsertIpSharingApproval(ipAddress: string, companyData: string): Promise<IpSharingApproval>;
  reviewIpSharingApproval(id: number, status: 'approved' | 'rejected', reviewedById: string, reviewedByName: string, reason?: string): Promise<IpSharingApproval>;
}

export class DatabaseStorage implements IStorage {
  async getCalls(limit: number = 20): Promise<CallWithLatestMetric[]> {
    const activeCalls = await db.select().from(calls)
      .orderBy(desc(calls.startTime))
      .limit(limit);
      
    // Fetch latest metric for each call to display real-time status
    const callsWithMetrics = await Promise.all(activeCalls.map(async (call) => {
      const [latestMetric] = await db.select().from(metrics)
        .where(eq(metrics.callId, call.id))
        .orderBy(desc(metrics.timestamp))
        .limit(1);
      return { ...call, latestMetric };
    }));
    
    return callsWithMetrics;
  }

  async getCall(id: number): Promise<Call | undefined> {
    const [call] = await db.select().from(calls).where(eq(calls.id, id));
    return call;
  }

  async createCall(call: InsertCall): Promise<Call> {
    const [newCall] = await db.insert(calls).values(call).returning();
    return newCall;
  }

  async endCall(id: number, status: 'completed' | 'failed' = 'completed', failReason?: string): Promise<void> {
    await db.update(calls)
      .set({ status, endTime: new Date(), ...(failReason ? { failReason } : {}) })
      .where(eq(calls.id, id));
  }

  async getMetricsForCall(callId: number): Promise<Metric[]> {
    return await db.select().from(metrics)
      .where(eq(metrics.callId, callId))
      .orderBy(desc(metrics.timestamp)) // Latest first
      .limit(50); // Limit to last 50 points for graph
  }

  async createMetric(metric: InsertMetric): Promise<Metric> {
    const [newMetric] = await db.insert(metrics).values(metric).returning();
    return newMetric;
  }

  async getAlerts(): Promise<Alert[]> {
    return await db.select().from(alerts)
      .orderBy(desc(alerts.createdAt))
      .limit(20);
  }

  async getAlertsInRange(from: Date, to: Date): Promise<Alert[]> {
    return await db.select().from(alerts)
      .where(and(gte(alerts.createdAt, from), lt(alerts.createdAt, to)))
      .orderBy(alerts.createdAt)
      .limit(2000);
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const [newAlert] = await db.insert(alerts).values(alert).returning();
    return newAlert;
  }

  async acknowledgeAlert(id: number, userId: string): Promise<Alert | null> {
    const [row] = await db.update(alerts)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: userId })
      .where(eq(alerts.id, id))
      .returning();
    return row ?? null;
  }

  async resolveAlert(id: number): Promise<Alert | null> {
    const [row] = await db.update(alerts)
      .set({ resolved: true, resolvedAt: new Date() })
      .where(eq(alerts.id, id))
      .returning();
    return row ?? null;
  }

  async getSettings(): Promise<Settings> {
    const [existingSettings] = await db.select().from(settings).limit(1);

    // Known Sippy credentials — always seeded so the app works out of the box
    const SIPPY_DEFAULTS = {
      switchType:       'sippy'               as const,
      portalUrl:        'https://104.245.246.110',
      portalUsername:   'RTST-1',
      portalPassword:   'abcd@1234',
      apiAdminUsername: 'ssp-root',
      apiAdminPassword: '!chiaan1',
    };

    if (existingSettings) {
      // Patch any missing credential fields without overwriting user changes
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(SIPPY_DEFAULTS)) {
        if (!existingSettings[k as keyof typeof existingSettings]) patch[k] = v;
      }
      // Self-healing: detect swapped portal/admin USERNAMES and auto-correct.
      // Sippy admin usernames conventionally start with "ssp-" (e.g. "ssp-root"),
      // and customer portal usernames never do. If they're flipped, swap them back
      // (along with their passwords, which were entered with the now-swapped names).
      const pUser = existingSettings.portalUsername || '';
      const aUser = existingSettings.apiAdminUsername || '';
      const looksAdmin = (u: string) => /^ssp[-_]/i.test(u);
      if (pUser && aUser && looksAdmin(pUser) && !looksAdmin(aUser)) {
        console.warn(`[settings] Detected swapped Sippy creds — auto-correcting (portal="${pUser}" ↔ admin="${aUser}").`);
        patch.portalUsername    = aUser;
        patch.apiAdminUsername  = pUser;
        patch.portalPassword    = existingSettings.apiAdminPassword || existingSettings.portalPassword;
        patch.apiAdminPassword  = existingSettings.portalPassword   || existingSettings.apiAdminPassword;
      }

      // Self-healing #2: if usernames are correct (RTST1 / ssp-root) but the
      // passwords ended up swapped (a side-effect of the previous self-heal
      // running on a DB that only had the usernames swapped), swap them back.
      // The admin password convention starts with "!" (e.g. "!chiaan1") and
      // customer portal passwords do not. This is a safe heuristic.
      const finalPUser = (patch.portalUsername   as string) || pUser;
      const finalAUser = (patch.apiAdminUsername as string) || aUser;
      const finalPPass = (patch.portalPassword   as string) || existingSettings.portalPassword   || '';
      const finalAPass = (patch.apiAdminPassword as string) || existingSettings.apiAdminPassword || '';
      if (
        finalPUser && finalAUser && !looksAdmin(finalPUser) && looksAdmin(finalAUser) &&
        finalPPass.startsWith('!') && !finalAPass.startsWith('!') &&
        finalPPass && finalAPass
      ) {
        console.warn(`[settings] Detected swapped Sippy passwords — auto-correcting.`);
        patch.portalPassword   = finalAPass;
        patch.apiAdminPassword = finalPPass;
      }
      if (Object.keys(patch).length > 0) {
        const [patched] = await db.update(settings)
          .set(patch)
          .where(eq(settings.id, existingSettings.id))
          .returning();
        return patched;
      }
      return existingSettings;
    }

    // Create default settings with Sippy credentials pre-seeded
    const [newSettings] = await db.insert(settings).values(SIPPY_DEFAULTS).returning();
    return newSettings;
  }

  /** Alias of getSettings() — used by all Sippy XML-RPC routes. */
  async getSippySettings(): Promise<Settings> {
    return this.getSettings();
  }

  async updateSettings(updates: UpdateSettingsRequest): Promise<Settings> {
    const currentSettings = await this.getSettings();
    const [updated] = await db.update(settings)
      .set(updates)
      .where(eq(settings.id, currentSettings.id))
      .returning();
    return updated;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    // 1. Count active calls
    const [activeCallsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(calls)
      .where(eq(calls.status, 'active'));
      
    // 2. Calculate Avg MOS from latest metrics
    const latestMetrics = await db
      .select({ mos: metrics.mos })
      .from(metrics)
      .orderBy(desc(metrics.timestamp))
      .limit(100);
      
    const totalMos = latestMetrics.reduce((sum, m) => sum + m.mos, 0);
    const avgMos = latestMetrics.length > 0 ? totalMos / latestMetrics.length : 4.5;
      
    // 3. Count alerts created today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const [alertsCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(sql`${alerts.createdAt} >= ${startOfDay}`);
      
    // 4. Determine System Health
    const alertsNum = Number(alertsCount?.count || 0);
    let systemHealth: 'Healthy' | 'Degraded' | 'Critical' = 'Healthy';
    if (alertsNum > 50) systemHealth = 'Critical';
    else if (alertsNum > 10) systemHealth = 'Degraded';

    // 5. ASR (Answer-Seizure Ratio): completed / (completed + failed) * 100
    //    Standard telecom definition: answered seizures / total seizures
    //    Use a rolling 30-minute window so new failures surface immediately
    const windowStart = new Date(Date.now() - 30 * 60 * 1000);
    const recentFinishedCalls = await db
      .select({ status: calls.status, startTime: calls.startTime, endTime: calls.endTime, pdd: calls.pdd })
      .from(calls)
      .where(sql`${calls.status} IN ('completed', 'failed') AND ${calls.startTime} >= ${windowStart}`)
      .orderBy(desc(calls.startTime))
      .limit(500);

    const completedCalls = recentFinishedCalls.filter(c => c.status === 'completed');
    const totalAttempted = recentFinishedCalls.length;
    const asr = totalAttempted > 0
      ? Math.round((completedCalls.length / totalAttempted) * 100 * 10) / 10
      : 100;

    // 6. ACD (Average Call Duration) in seconds for completed calls
    const durationsSeconds = completedCalls
      .filter(c => c.startTime && c.endTime)
      .map(c => (new Date(c.endTime!).getTime() - new Date(c.startTime!).getTime()) / 1000);
    const acd = durationsSeconds.length > 0
      ? Math.round(durationsSeconds.reduce((s, d) => s + d, 0) / durationsSeconds.length)
      : 0;

    // 7. PDD (Post-Dial Delay) average in seconds from all calls with pdd recorded
    const pddValues = recentFinishedCalls
      .concat(
        (await db.select({ status: calls.status, startTime: calls.startTime, endTime: calls.endTime, pdd: calls.pdd })
          .from(calls).where(eq(calls.status, 'active')).limit(50))
      )
      .filter(c => c.pdd !== null && c.pdd !== undefined)
      .map(c => c.pdd as number);
    const pdd = pddValues.length > 0
      ? Math.round((pddValues.reduce((s, v) => s + v, 0) / pddValues.length) * 100) / 100
      : 0;

    // 8. CK Ratio — Connection Rate: confirmed connected / total attempted (today's window)
    //    Connected = completed (answered by user)
    //    Failed = wrong_number | switched_off | untraceable
    const todayAllCalls = await db
      .select({ status: calls.status, failReason: calls.failReason })
      .from(calls)
      .where(sql`${calls.startTime} >= ${startOfDay}`)
      .limit(5000);

    const ckConnected = todayAllCalls.filter(c => c.status === 'completed').length;
    const ckWrongNumber = todayAllCalls.filter(c => c.failReason === 'wrong_number').length;
    const ckSwitchedOff = todayAllCalls.filter(c => c.failReason === 'switched_off').length;
    const ckUntraceable = todayAllCalls.filter(c => c.failReason === 'untraceable').length;
    const ckTotal = todayAllCalls.length; // includes active calls as "attempts"
    const ckRatio = ckTotal > 0
      ? Math.round((ckConnected / ckTotal) * 100 * 10) / 10
      : 0;

    return {
      activeCalls: Number(activeCallsCount?.count || 0),
      avgMos: Number(avgMos || 4.5),
      alertsToday: alertsNum,
      systemHealth,
      asr,
      acd,
      pdd,
      ckRatio,
      ckBreakdown: {
        connected: ckConnected,
        wrongNumber: ckWrongNumber,
        switchedOff: ckSwitchedOff,
        untraceable: ckUntraceable,
        total: ckTotal,
      },
    };
  }

  async getAsrAcdReport(filters: AsrAcdReportFilters): Promise<AsrAcdReportRow[]> {
    const {
      cliFilter,
      cldFilter,
      startTime,
      endTime,
      groupBy = 'caller',
      sortBy = 'totalCalls',
      hideEmpty = true,
    } = filters;

    const RATE_PER_MIN = 0.025;
    const groupColName = groupBy === 'callee' ? 'callee' : 'caller';

    const orderMap: Record<string, string> = {
      totalCalls: 'total_calls DESC',
      asr: 'asr DESC',
      billableCalls: 'billable_calls DESC',
      revenueUsd: 'revenue_usd DESC',
    };
    const orderClause = orderMap[sortBy] || 'total_calls DESC';

    // Build parameterized WHERE conditions using sql template tag
    const condParts: ReturnType<typeof sql>[] = [
      sql`status IN ('completed', 'failed')`,
    ];
    if (startTime) condParts.push(sql`start_time >= ${new Date(startTime)}`);
    if (endTime)   condParts.push(sql`start_time <= ${new Date(endTime)}`);
    if (cliFilter) condParts.push(sql`caller ILIKE ${'%' + cliFilter + '%'}`);
    if (cldFilter) condParts.push(sql`callee ILIKE ${'%' + cldFilter + '%'}`);

    const whereClause = sql`WHERE ${sql.join(condParts, sql` AND `)}`;
    const havingClause = hideEmpty ? sql`HAVING COUNT(*) > 0` : sql``;

    const rows = await db.execute(sql`
      SELECT
        ${sql.raw(groupColName)} AS caller,
        COUNT(*) AS total_calls,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS billable_calls,
        COALESCE(SUM(CASE WHEN status = 'completed' AND end_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) ELSE 0 END), 0) AS billed_duration_seconds,
        COALESCE(AVG(CASE WHEN status = 'completed' AND end_time IS NOT NULL
          THEN EXTRACT(EPOCH FROM (end_time - start_time)) END), 0) AS acd_seconds,
        ROUND(
          (COUNT(CASE WHEN status = 'completed' THEN 1 END)::numeric /
           NULLIF(COUNT(*), 0) * 100), 4
        ) AS asr,
        COALESCE(AVG(pdd), 0) AS avg_pdd,
        ROUND(
          (COALESCE(SUM(CASE WHEN status = 'completed' AND end_time IS NOT NULL
            THEN EXTRACT(EPOCH FROM (end_time - start_time)) ELSE 0 END), 0) / 60.0 * ${RATE_PER_MIN})::numeric, 7
        ) AS revenue_usd
      FROM calls
      ${whereClause}
      GROUP BY ${sql.raw(groupColName)}
      ${havingClause}
      ORDER BY ${sql.raw(orderClause)}
      LIMIT 200
    `);

    return (rows.rows as any[]).map(r => ({
      caller: r.caller ?? '',
      totalCalls: Number(r.total_calls),
      billableCalls: Number(r.billable_calls),
      billedDurationSeconds: Number(r.billed_duration_seconds),
      acdSeconds: Number(r.acd_seconds),
      asr: Number(r.asr),
      avgPdd: Number(r.avg_pdd),
      revenueUsd: Number(r.revenue_usd),
    }));
  }

  // ── Team / Roles ──────────────────────────────────────────────────────────

  async getUserRole(userId: string): Promise<Role | null> {
    const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    return (row?.role as Role) ?? null;
  }

  async getUserRoleRecord(userId: string): Promise<{ role: Role; teamId: string | null } | null> {
    const [row] = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    if (!row) return null;
    return { role: row.role as Role, teamId: row.teamId ?? null };
  }

  async setUserRole(userId: string, role: Role, assignedBy?: string, teamId?: string | null): Promise<void> {
    await db.insert(userRoles)
      .values({ userId, role, assignedBy, teamId: teamId ?? null })
      .onConflictDoUpdate({ target: userRoles.userId, set: { role, assignedBy, teamId: teamId ?? null, assignedAt: new Date() } });
  }

  async countRoleEntries(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(userRoles);
    return Number(row?.count ?? 0);
  }

  // ── RBAC Matrix ────────────────────────────────────────────────────────────

  async getRbacPermissions(): Promise<RbacPermission[]> {
    return db.select().from(rbacPermissions).orderBy(rbacPermissions.domain, rbacPermissions.key);
  }

  async getRbacRolePermissions(role?: string): Promise<RbacRolePermission[]> {
    if (role) {
      return db.select().from(rbacRolePermissions).where(eq(rbacRolePermissions.role, role));
    }
    return db.select().from(rbacRolePermissions);
  }

  async setRbacRolePermission(role: string, permissionKey: string, granted: boolean, actorId?: string): Promise<void> {
    const existing = await db.select().from(rbacRolePermissions)
      .where(and(eq(rbacRolePermissions.role, role), eq(rbacRolePermissions.permissionKey, permissionKey)));
    const before = existing[0] ?? null;
    await db.insert(rbacRolePermissions)
      .values({ role, permissionKey, granted, grantedBy: actorId })
      .onConflictDoUpdate({
        target: [rbacRolePermissions.role, rbacRolePermissions.permissionKey],
        set: { granted, grantedBy: actorId, grantedAt: new Date() },
      });
    if (actorId) {
      await db.insert(rbacPermissionAuditEvents).values({
        eventType:     granted ? 'permission_granted' : 'permission_revoked',
        actorId,
        targetRole:    role,
        permissionKey,
        beforeValue:   before ? { granted: before.granted } : null,
        afterValue:    { granted },
      });
    }
  }

  async getRbacUserOverrides(userId?: string): Promise<RbacUserPermissionOverride[]> {
    if (userId) {
      return db.select().from(rbacUserPermissionOverrides).where(eq(rbacUserPermissionOverrides.userId, userId));
    }
    return db.select().from(rbacUserPermissionOverrides);
  }

  async deleteRbacUserOverride(id: number): Promise<void> {
    await db.delete(rbacUserPermissionOverrides).where(eq(rbacUserPermissionOverrides.id, id));
  }

  async getRbacAuditLog(limit = 200): Promise<RbacPermissionAuditEvent[]> {
    return db.select().from(rbacPermissionAuditEvents)
      .orderBy(desc(rbacPermissionAuditEvents.createdAt))
      .limit(limit);
  }

  async getAllUsersWithRoles(): Promise<Array<User & { role: Role; teamId: string | null }>> {
    const allUsers = await db.select().from(users);
    const allRoles = await db.select().from(userRoles);
    const roleMap = new Map(allRoles.map(r => [r.userId, { role: r.role as Role, teamId: r.teamId ?? null }]));
    return allUsers.map(u => ({
      ...u,
      role: roleMap.get(u.id)?.role ?? ('viewer' as Role),
      teamId: roleMap.get(u.id)?.teamId ?? null,
    }));
  }

  async getUserTeamId(userId: string): Promise<string | null> {
    const [row] = await db.select({ teamId: userRoles.teamId }).from(userRoles).where(eq(userRoles.userId, userId));
    return row?.teamId ?? null;
  }

  // ── Client & Vendor Profiles ───────────────────────────────────────────────

  async getClientProfiles(): Promise<ClientProfile[]> {
    return await db.select().from(clientProfiles).orderBy(clientProfiles.type, clientProfiles.name);
  }

  async createClientProfile(profile: InsertClientProfile): Promise<ClientProfile> {
    const [created] = await db.insert(clientProfiles).values(profile).returning();
    return created;
  }

  async updateClientProfile(id: number, updates: Partial<InsertClientProfile>): Promise<ClientProfile> {
    const [updated] = await db.update(clientProfiles).set(updates).where(eq(clientProfiles.id, id)).returning();
    return updated;
  }

  async deleteClientProfile(id: number): Promise<void> {
    await db.delete(clientProfiles).where(eq(clientProfiles.id, id));
  }

  // ── Switches ───────────────────────────────────────────────────────────────

  async getSwitches(): Promise<Switch[]> {
    return db.select().from(switches).orderBy(switches.createdAt);
  }

  async createSwitch(sw: InsertSwitch): Promise<Switch> {
    const [created] = await db.insert(switches).values(sw).returning();
    return created;
  }

  async updateSwitch(id: number, updates: Partial<InsertSwitch>): Promise<Switch> {
    const [updated] = await db.update(switches).set(updates).where(eq(switches.id, id)).returning();
    return updated;
  }

  async deleteSwitch(id: number): Promise<void> {
    await db.delete(switches).where(eq(switches.id, id));
  }

  // ── User Configuration ─────────────────────────────────────────────────────

  async getUserConfig(userId: string): Promise<UserConfig | null> {
    const [row] = await db.select().from(userConfig).where(eq(userConfig.userId, userId));
    return row ?? null;
  }

  async upsertUserConfig(userId: string, config: Partial<InsertUserConfig>): Promise<UserConfig> {
    const [row] = await db
      .insert(userConfig)
      .values({ ...config, userId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: userConfig.userId,
        set: { ...config, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  // ── FAS Events ─────────────────────────────────────────────────────────────

  async getFasEvents(limit: number = 100, vendor?: string): Promise<FasEvent[]> {
    const q = db.select().from(fasEvents);
    if (vendor) {
      return q.where(eq(fasEvents.vendor, vendor)).orderBy(desc(fasEvents.detectedAt)).limit(limit);
    }
    return q.orderBy(desc(fasEvents.detectedAt)).limit(limit);
  }

  async createFasEvent(event: InsertFasEvent): Promise<FasEvent> {
    const [row] = await db.insert(fasEvents).values(event).returning();
    return row;
  }

  async markFasAlertSent(id: number): Promise<void> {
    await db.update(fasEvents).set({ alertSent: true }).where(eq(fasEvents.id, id));
  }

  async backfillFasEventVendors(vendorName: string): Promise<number> {
    const rows = await db.update(fasEvents)
      .set({ vendor: vendorName })
      .where(sql`(vendor IS NULL OR vendor = '')`)
      .returning({ id: fasEvents.id });
    return rows.length;
  }

  // ── FAS Vendor Settings ────────────────────────────────────────────────────

  async listFasVendorSettings(): Promise<FasVendorSetting[]> {
    return db.select().from(fasVendorSettings).orderBy(fasVendorSettings.vendor);
  }

  async getFasVendorSetting(vendor: string): Promise<FasVendorSetting | null> {
    const [row] = await db.select().from(fasVendorSettings).where(eq(fasVendorSettings.vendor, vendor));
    return row ?? null;
  }

  async upsertFasVendorSetting(vendor: string, data: Partial<InsertFasVendorSetting>): Promise<FasVendorSetting> {
    const [row] = await db.insert(fasVendorSettings)
      .values({ vendor, ...data })
      .onConflictDoUpdate({
        target: fasVendorSettings.vendor,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async deleteFasVendorSetting(vendor: string): Promise<void> {
    await db.delete(fasVendorSettings).where(eq(fasVendorSettings.vendor, vendor));
  }

  // ── Call Snapshots ─────────────────────────────────────────────────────────

  async upsertCallSnapshot(snapshot: InsertCallSnapshot): Promise<void> {
    await db.insert(callSnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: callSnapshots.sippyCallId,
        set: {
          ccState:         snapshot.ccState,
          maxDurationSecs: sql`GREATEST(call_snapshots.max_duration_secs, EXCLUDED.max_duration_secs)`,
          lastSeen:        snapshot.lastSeen ?? new Date(),
          mediaIpCaller:   snapshot.mediaIpCaller,
          mediaIpCallee:   snapshot.mediaIpCallee,
          codec:           snapshot.codec,
          vendor:          snapshot.vendor,
          clientName:      snapshot.clientName,
        },
      });
  }

  async getCallHistory(hoursBack: number = 24): Promise<CallSnapshot[]> {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000);
    return db.select().from(callSnapshots)
      .where(gte(callSnapshots.firstSeen, since))
      .orderBy(desc(callSnapshots.lastSeen));
  }

  async cleanupOldSnapshots(): Promise<void> {
    const cutoff = new Date(Date.now() - 25 * 3600 * 1000); // 25h buffer
    await db.delete(callSnapshots).where(lt(callSnapshots.lastSeen, cutoff));
  }

  async getAllMonitoringAssignments(): Promise<Record<string, string[]>> {
    const rows = await db.select().from(monitoringAssignments);
    const result: Record<string, string[]> = {};
    for (const row of rows) {
      result[row.userId] = row.items ?? [];
    }
    return result;
  }

  async setMonitoringAssignments(userId: string, items: string[], assignedBy?: string): Promise<void> {
    await db.insert(monitoringAssignments)
      .values({ userId, items, assignedBy: assignedBy ?? null, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: monitoringAssignments.userId,
        set: { items, assignedBy: assignedBy ?? null, updatedAt: new Date() },
      });
  }

  // ── Outage Log ───────────────────────────────────────────────────────────────
  async getOutageLog(limit = 50): Promise<OutageEntry[]> {
    return db.select().from(outageLog).orderBy(desc(outageLog.downAt)).limit(limit);
  }

  async getLatestOutageEntry(): Promise<OutageEntry | null> {
    const rows = await db.select().from(outageLog).orderBy(desc(outageLog.downAt)).limit(1);
    return rows[0] ?? null;
  }

  async createOutageEntry(entry: InsertOutageEntry): Promise<OutageEntry> {
    const rows = await db.insert(outageLog).values(entry).returning();
    return rows[0];
  }

  async updateOutageEntry(id: number, updates: Partial<OutageEntry>): Promise<void> {
    await db.update(outageLog).set(updates).where(eq(outageLog.id, id));
  }

  // ── Alert Rules ──────────────────────────────────────────────────────────────
  async getAlertRules(): Promise<AlertRule[]> {
    return db.select().from(alertRules).orderBy(desc(alertRules.createdAt));
  }

  async createAlertRule(rule: InsertAlertRule): Promise<AlertRule> {
    const rows = await db.insert(alertRules).values(rule).returning();
    return rows[0];
  }

  async updateAlertRule(id: number, updates: Partial<AlertRule>): Promise<void> {
    await db.update(alertRules).set(updates).where(eq(alertRules.id, id));
  }

  async deleteAlertRule(id: number): Promise<void> {
    await db.delete(alertRules).where(eq(alertRules.id, id));
  }

  // ── Monitored Hosts ──────────────────────────────────────────────────────────
  async getMonitoredHosts(): Promise<MonitoredHost[]> {
    return db.select().from(monitoredHosts).orderBy(monitoredHosts.createdAt);
  }

  async createMonitoredHost(host: InsertMonitoredHost): Promise<MonitoredHost> {
    const [row] = await db.insert(monitoredHosts).values(host).returning();
    return row;
  }

  async updateMonitoredHost(id: number, updates: Partial<InsertMonitoredHost>): Promise<MonitoredHost> {
    const [row] = await db.update(monitoredHosts).set(updates).where(eq(monitoredHosts.id, id)).returning();
    return row;
  }

  async deleteMonitoredHost(id: number): Promise<void> {
    await db.delete(monitoredHosts).where(eq(monitoredHosts.id, id));
    await db.delete(hostOutageLog).where(eq(hostOutageLog.hostId, id));
  }

  // ── Host Outage Log ──────────────────────────────────────────────────────────
  async getHostOutageLog(hostId?: number, limit = 50): Promise<HostOutageEntry[]> {
    if (hostId !== undefined) {
      return db.select().from(hostOutageLog)
        .where(eq(hostOutageLog.hostId, hostId))
        .orderBy(desc(hostOutageLog.downAt))
        .limit(limit);
    }
    return db.select().from(hostOutageLog).orderBy(desc(hostOutageLog.downAt)).limit(limit);
  }

  async createHostOutageEntry(entry: InsertHostOutageEntry): Promise<HostOutageEntry> {
    const [row] = await db.insert(hostOutageLog).values(entry).returning();
    return row;
  }

  async updateHostOutageEntry(id: number, updates: Partial<HostOutageEntry>): Promise<void> {
    await db.update(hostOutageLog).set(updates).where(eq(hostOutageLog.id, id));
  }

  // ── KAM Management ───────────────────────────────────────────────────────────
  async getKams(): Promise<Kam[]> {
    return db.select().from(kams).orderBy(kams.name);
  }

  async getKam(id: number): Promise<Kam | undefined> {
    const [row] = await db.select().from(kams).where(eq(kams.id, id));
    return row;
  }

  async getKamByUserId(userId: string): Promise<Kam | undefined> {
    const [row] = await db.select().from(kams).where(eq(kams.userId, userId));
    return row;
  }

  // Returns the IDs of this KAM + all subordinates (BFS over reportsTo relationships)
  async getKamSubtreeIds(kamId: number): Promise<number[]> {
    const all = await db.select().from(kams);
    const result: number[] = [];
    const queue = [kamId];
    while (queue.length) {
      const current = queue.shift()!;
      result.push(current);
      all.filter(k => k.reportsTo === current).forEach(k => queue.push(k.id));
    }
    return result;
  }

  // Returns all Sippy account IDs visible to this KAM's subtree
  async getAccountsForSubtree(kamId: number): Promise<string[]> {
    const subtreeIds = await this.getKamSubtreeIds(kamId);
    if (!subtreeIds.length) return [];
    const rows = await db.select().from(kamAccounts)
      .where(inArray(kamAccounts.kamId, subtreeIds));
    return [...new Set(rows.map(r => r.accountId))];
  }

  async createKam(kam: InsertKam): Promise<Kam> {
    const [row] = await db.insert(kams).values(kam).returning();
    return row;
  }

  async updateKam(id: number, updates: Partial<InsertKam>): Promise<Kam> {
    const [row] = await db.update(kams).set(updates).where(eq(kams.id, id)).returning();
    return row;
  }

  async deleteKam(id: number): Promise<void> {
    await db.delete(kamAccounts).where(eq(kamAccounts.kamId, id));
    await db.delete(kams).where(eq(kams.id, id));
  }

  // ── KAM Account Assignments ───────────────────────────────────────────────────
  async getKamAccounts(kamId?: number): Promise<KamAccount[]> {
    if (kamId !== undefined) {
      return db.select().from(kamAccounts).where(eq(kamAccounts.kamId, kamId));
    }
    return db.select().from(kamAccounts);
  }

  async createKamAccount(ka: InsertKamAccount): Promise<KamAccount> {
    const [row] = await db.insert(kamAccounts).values(ka).returning();
    return row;
  }

  async updateKamAccount(id: number, patch: Partial<Pick<KamAccount, 'alertEmail' | 'clientName' | 'dropThreshold'>>): Promise<KamAccount> {
    const [row] = await db.update(kamAccounts).set(patch).where(eq(kamAccounts.id, id)).returning();
    return row;
  }

  async deleteKamAccount(id: number): Promise<void> {
    await db.delete(kamAccounts).where(eq(kamAccounts.id, id));
  }

  // ── Traffic Alerts ────────────────────────────────────────────────────────────
  async getTrafficAlerts(limit = 50): Promise<TrafficAlert[]> {
    return db.select().from(trafficAlerts)
      .orderBy(desc(trafficAlerts.triggeredAt))
      .limit(limit);
  }

  async createTrafficAlert(alert: InsertTrafficAlert): Promise<TrafficAlert> {
    const [row] = await db.insert(trafficAlerts).values(alert).returning();
    return row;
  }

  async updateTrafficAlert(id: number, updates: Partial<TrafficAlert>): Promise<void> {
    await db.update(trafficAlerts).set(updates).where(eq(trafficAlerts.id, id));
  }

  async getOpenTrafficAlert(clientName: string): Promise<TrafficAlert | undefined> {
    const [row] = await db.select().from(trafficAlerts)
      .where(and(
        eq(trafficAlerts.clientName, clientName),
        sql`${trafficAlerts.resolvedAt} IS NULL`,
        sql`${trafficAlerts.alertType} != 'traffic_restored'`
      ))
      .orderBy(desc(trafficAlerts.triggeredAt))
      .limit(1);
    return row;
  }

  // ── Sippy Snapshots ──────────────────────────────────────────────────────────
  async getSippySnapshot(key: string): Promise<any | null> {
    const [row] = await db.select().from(sippySnapshots).where(eq(sippySnapshots.key, key));
    return row?.data ?? null;
  }

  async setSippySnapshot(key: string, data: any): Promise<void> {
    await db.insert(sippySnapshots).values({ key, data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: sippySnapshots.key, set: { data, updatedAt: new Date() } });
  }

  async recordSippyChangeEvents(events: InsertSippyChangeEvent[]): Promise<void> {
    if (!events.length) return;
    await db.insert(sippyChangeEvents).values(events);
  }

  async listSippyChangeEvents(opts: { category?: string; limit?: number } = {}): Promise<SippyChangeEvent[]> {
    const limit = Math.min(opts.limit ?? 200, 1000);
    if (opts.category) {
      return db.select().from(sippyChangeEvents)
        .where(eq(sippyChangeEvents.category, opts.category))
        .orderBy(desc(sippyChangeEvents.detectedAt))
        .limit(limit);
    }
    return db.select().from(sippyChangeEvents)
      .orderBy(desc(sippyChangeEvents.detectedAt))
      .limit(limit);
  }

  // ── Watcher Recipients ────────────────────────────────────────────────────────
  async getWatcherRecipients(): Promise<WatcherRecipient[]> {
    return db.select().from(watcherRecipients).orderBy(watcherRecipients.createdAt);
  }

  async addWatcherRecipient(data: InsertWatcherRecipient): Promise<WatcherRecipient> {
    const [row] = await db.insert(watcherRecipients).values(data).returning();
    return row;
  }

  async updateWatcherRecipient(id: number, data: Partial<InsertWatcherRecipient>): Promise<WatcherRecipient | undefined> {
    const [row] = await db.update(watcherRecipients).set(data).where(eq(watcherRecipients.id, id)).returning();
    return row;
  }

  async deleteWatcherRecipient(id: number): Promise<void> {
    await db.delete(watcherRecipients).where(eq(watcherRecipients.id, id));
  }

  // ── IRSF Events ──────────────────────────────────────────────────────────────
  async getIrsfEvents(limit = 200): Promise<IrsfEvent[]> {
    return db.select().from(irsfEvents).orderBy(desc(irsfEvents.detectedAt)).limit(limit);
  }

  async createIrsfEvent(event: InsertIrsfEvent): Promise<IrsfEvent> {
    const [row] = await db.insert(irsfEvents).values(event).returning();
    return row;
  }

  // ── Blacklist Rules ───────────────────────────────────────────────────────────
  async getBlacklistRules(): Promise<BlacklistRule[]> {
    return db.select().from(blacklistRules).orderBy(desc(blacklistRules.createdAt));
  }

  async createBlacklistRule(rule: InsertBlacklistRule): Promise<BlacklistRule> {
    const [row] = await db.insert(blacklistRules).values(rule).returning();
    return row;
  }

  async updateBlacklistRule(id: number, updates: Partial<InsertBlacklistRule>): Promise<BlacklistRule | undefined> {
    const [row] = await db.update(blacklistRules).set(updates).where(eq(blacklistRules.id, id)).returning();
    return row;
  }

  async deleteBlacklistRule(id: number): Promise<void> {
    await db.delete(blacklistRules).where(eq(blacklistRules.id, id));
  }

  async incrementBlacklistHit(id: number): Promise<void> {
    await db.update(blacklistRules)
      .set({ hitCount: sql`${blacklistRules.hitCount} + 1` })
      .where(eq(blacklistRules.id, id));
  }

  // ── Rate Cards ────────────────────────────────────────────────────────────────
  async getRateCards(): Promise<RateCard[]> {
    return db.select().from(rateCards).orderBy(desc(rateCards.createdAt));
  }

  async createRateCard(card: InsertRateCard): Promise<RateCard> {
    const [row] = await db.insert(rateCards).values(card).returning();
    return row;
  }

  async deleteRateCard(id: number): Promise<void> {
    await db.delete(rateCardEntries).where(eq(rateCardEntries.rateCardId, id));
    await db.delete(rateCards).where(eq(rateCards.id, id));
  }

  async getRateCardEntries(rateCardId: number): Promise<RateCardEntry[]> {
    return db.select().from(rateCardEntries)
      .where(eq(rateCardEntries.rateCardId, rateCardId))
      .orderBy(rateCardEntries.prefix);
  }

  async bulkInsertRateCardEntries(entries: InsertRateCardEntry[]): Promise<number> {
    if (!entries.length) return 0;
    // Insert in batches of 500 to avoid parameter limits
    let inserted = 0;
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500);
      await db.insert(rateCardEntries).values(batch);
      inserted += batch.length;
    }
    return inserted;
  }

  async updateRateCardEntryCount(rateCardId: number, count: number): Promise<void> {
    await db.update(rateCards).set({ entryCount: count }).where(eq(rateCards.id, rateCardId));
  }

  async lookupRateForPrefix(rateCardId: number, callee: string): Promise<RateCardEntry | null> {
    const digits = callee.replace(/^\+/, '').replace(/\D/g, '');
    // Try progressively shorter prefixes from longest match down
    for (let len = Math.min(digits.length, 11); len >= 1; len--) {
      const prefix = digits.slice(0, len);
      const [row] = await db.select().from(rateCardEntries)
        .where(and(eq(rateCardEntries.rateCardId, rateCardId), eq(rateCardEntries.prefix, prefix)))
        .limit(1);
      if (row) return row;
    }
    return null;
  }

  async lcrAnalyse(number: string, clientRateCardId?: number): Promise<{
    vendorResults: { card: RateCard; entry: RateCardEntry }[];
    clientEntry: RateCardEntry | null;
  }> {
    const allCards = await this.getRateCards();
    const vendorCards = allCards.filter(c => c.cardType === 'vendor');

    const vendorResults: { card: RateCard; entry: RateCardEntry }[] = [];
    for (const card of vendorCards) {
      const entry = await this.lookupRateForPrefix(card.id, number);
      if (entry) vendorResults.push({ card, entry });
    }
    vendorResults.sort((a, b) => a.entry.ratePerMin - b.entry.ratePerMin);

    let clientEntry: RateCardEntry | null = null;
    if (clientRateCardId) {
      clientEntry = await this.lookupRateForPrefix(clientRateCardId, number);
    }

    return { vendorResults, clientEntry };
  }

  // ── MOS Hourly ────────────────────────────────────────────────────────────────
  async getMosHourly(hoursBack = 24, vendor?: string): Promise<MosHourly[]> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const conditions = [gte(mosHourly.hour, since)];
    if (vendor && vendor !== '__all__') conditions.push(eq(mosHourly.vendor, vendor));
    else if (!vendor || vendor === '__all__') conditions.push(sql`${mosHourly.vendor} IS NULL`);
    return db.select().from(mosHourly).where(and(...conditions)).orderBy(mosHourly.hour);
  }

  async upsertMosHourly(hour: Date, vendor: string | null, avgMos: number, minMos: number, maxMos: number, callCount: number): Promise<void> {
    await db.insert(mosHourly)
      .values({ hour, vendor, avgMos, minMos, maxMos, callCount })
      .onConflictDoNothing();
  }

  // ── API Keys ───────────────────────────────────────────────────────────────
  async getApiKeys(userId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async createApiKey(data: { userId: string; name: string; keyHash: string; keyPrefix: string; permissions: string[] }): Promise<ApiKey> {
    const [row] = await db.insert(apiKeys).values(data).returning();
    return row;
  }

  async revokeApiKey(id: number, userId: string): Promise<void> {
    await db.update(apiKeys)
      .set({ active: false })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)));
  }

  async validateApiKey(keyHash: string): Promise<ApiKey | null> {
    const [row] = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), eq(apiKeys.active, true)));
    return row ?? null;
  }

  async touchApiKey(id: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  // ── Dashboard Widget Prefs ────────────────────────────────────────────────
  async getDashboardWidgetPrefs(userId: string): Promise<DashboardWidgetPrefs | null> {
    const [row] = await db.select().from(dashboardWidgetPrefs).where(eq(dashboardWidgetPrefs.userId, userId));
    return row ?? null;
  }

  async setDashboardWidgetPrefs(userId: string, hiddenWidgets: string[], widgetOrder: string[] = []): Promise<DashboardWidgetPrefs> {
    const [row] = await db.insert(dashboardWidgetPrefs)
      .values({ userId, hiddenWidgets, widgetOrder })
      .onConflictDoUpdate({ target: dashboardWidgetPrefs.userId, set: { hiddenWidgets, widgetOrder, updatedAt: new Date() } })
      .returning();
    return row;
  }

  // ── Call Test Logs (Vol 2 — #16) ─────────────────────────────────────────────
  async logTestCall(data: InsertCallTestLog): Promise<CallTestLog> {
    const [row] = await db.insert(callTestLogs).values(data).returning();
    return row;
  }

  async getTestCallLogs(userId: string, limit = 50): Promise<CallTestLog[]> {
    return db.select().from(callTestLogs)
      .where(eq(callTestLogs.userId, userId))
      .orderBy(desc(callTestLogs.createdAt))
      .limit(limit);
  }

  // ── WhatsApp Alert Log ────────────────────────────────────────────────────
  async logWhatsappAlert(data: { alertType: string; recipient: string; message: string; status: string; errorMsg?: string | null }): Promise<void> {
    await db.insert(whatsappAlertLog).values({
      alertType: data.alertType,
      recipient: data.recipient,
      message:   data.message,
      status:    data.status,
      errorMsg:  data.errorMsg ?? null,
    });
  }

  async getWhatsappAlertLogs(limit = 100): Promise<WhatsappAlertLog[]> {
    return db.select().from(whatsappAlertLog)
      .orderBy(desc(whatsappAlertLog.sentAt))
      .limit(limit);
  }

  // ── Fix History (Phase 3) ─────────────────────────────────────────────────
  async addFixHistoryEntry(entry: InsertFixHistory): Promise<FixHistory> {
    const [row] = await db.insert(fixHistory).values(entry).returning();
    return row;
  }

  async getFixHistory(limit = 100): Promise<FixHistory[]> {
    return db.select().from(fixHistory)
      .orderBy(desc(fixHistory.createdAt))
      .limit(limit);
  }

  async getFixHistoryById(id: number): Promise<FixHistory | null> {
    const [row] = await db.select().from(fixHistory).where(eq(fixHistory.id, id)).limit(1);
    return row ?? null;
  }

  async findSimilarFix(issueType: string, component: string): Promise<FixHistory | null> {
    const [row] = await db.select().from(fixHistory)
      .where(
        and(
          eq(fixHistory.issueType, issueType),
          eq(fixHistory.outcome, 'success')
        )
      )
      .orderBy(desc(fixHistory.createdAt))
      .limit(1);
    return row ?? null;
  }

  // ── SIMbox Scores ─────────────────────────────────────────────────────────
  async getLatestSimboxScores(limit = 50): Promise<SimboxScore[]> {
    return db.select().from(simboxScores).orderBy(desc(simboxScores.createdAt)).limit(limit);
  }

  async upsertSimboxScore(score: InsertSimboxScore): Promise<SimboxScore> {
    const [row] = await db.insert(simboxScores).values(score).returning();
    return row;
  }

  async getSimboxScoresByVendor(vendorId: string, limit = 30): Promise<SimboxScore[]> {
    return db.select().from(simboxScores)
      .where(eq(simboxScores.vendorId, vendorId))
      .orderBy(desc(simboxScores.createdAt))
      .limit(limit);
  }

  // ── Billing Disputes ──────────────────────────────────────────────────────
  async getBillingDisputes(): Promise<BillingDispute[]> {
    return db.select().from(billingDisputes).orderBy(desc(billingDisputes.createdAt));
  }

  async createBillingDispute(dispute: InsertBillingDispute): Promise<BillingDispute> {
    const [row] = await db.insert(billingDisputes).values(dispute).returning();
    return row;
  }

  async updateBillingDispute(id: number, updates: Partial<InsertBillingDispute>): Promise<BillingDispute | undefined> {
    const [row] = await db.update(billingDisputes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(billingDisputes.id, id))
      .returning();
    return row;
  }

  async deleteBillingDispute(id: number): Promise<void> {
    await db.delete(billingDisputes).where(eq(billingDisputes.id, id));
  }

  // ── SLA Breach Log ────────────────────────────────────────────────────────
  async getSlaBreaches(limit = 200, vendorId?: string): Promise<SlaBreachEntry[]> {
    if (vendorId) {
      return db.select().from(slaBreachLog)
        .where(eq(slaBreachLog.vendorId, vendorId))
        .orderBy(desc(slaBreachLog.breachStart))
        .limit(limit);
    }
    return db.select().from(slaBreachLog).orderBy(desc(slaBreachLog.breachStart)).limit(limit);
  }

  async addSlaBreachEntry(entry: InsertSlaBreachEntry): Promise<SlaBreachEntry> {
    const [row] = await db.insert(slaBreachLog).values(entry).returning();
    return row;
  }

  async resolveSlaBreachEntry(id: number, breachEnd: Date, durationMinutes: number): Promise<void> {
    await db.update(slaBreachLog)
      .set({ resolved: true, breachEnd, durationMinutes })
      .where(eq(slaBreachLog.id, id));
  }

  async getOpenSlaBreach(vendorId: string, metric: string): Promise<SlaBreachEntry | null> {
    const [row] = await db.select().from(slaBreachLog)
      .where(and(eq(slaBreachLog.vendorId, vendorId), eq(slaBreachLog.metric, metric), eq(slaBreachLog.resolved, false)))
      .orderBy(desc(slaBreachLog.breachStart))
      .limit(1);
    return row ?? null;
  }

  // ── Test Campaigns ────────────────────────────────────────────────────────
  async getTestCampaigns(): Promise<TestCampaign[]> {
    return db.select().from(testCampaigns).orderBy(desc(testCampaigns.createdAt));
  }

  async getTestCampaign(id: number): Promise<TestCampaign | undefined> {
    const [row] = await db.select().from(testCampaigns).where(eq(testCampaigns.id, id)).limit(1);
    return row;
  }

  async createTestCampaign(campaign: InsertTestCampaign): Promise<TestCampaign> {
    const [row] = await db.insert(testCampaigns).values(campaign).returning();
    return row;
  }

  async updateTestCampaign(id: number, updates: Partial<InsertTestCampaign>): Promise<TestCampaign | undefined> {
    const [row] = await db.update(testCampaigns).set(updates).where(eq(testCampaigns.id, id)).returning();
    return row;
  }

  async deleteTestCampaign(id: number): Promise<void> {
    await db.delete(testCampaignResults).where(eq(testCampaignResults.campaignId, id));
    await db.delete(testCampaigns).where(eq(testCampaigns.id, id));
  }

  async addCampaignResult(result: InsertTestCampaignResult): Promise<TestCampaignResult> {
    const [row] = await db.insert(testCampaignResults).values(result).returning();
    return row;
  }

  async getCampaignResults(campaignId: number, limit = 100): Promise<TestCampaignResult[]> {
    return db.select().from(testCampaignResults)
      .where(eq(testCampaignResults.campaignId, campaignId))
      .orderBy(desc(testCampaignResults.runAt))
      .limit(limit);
  }

  async getCampaignsDueForRun(): Promise<TestCampaign[]> {
    const { and, lte, isNotNull } = await import('drizzle-orm');
    return db.select().from(testCampaigns).where(
      and(
        eq(testCampaigns.enabled, true),
        isNotNull(testCampaigns.nextRunAt),
        lte(testCampaigns.nextRunAt, new Date()),
        // Avoid re-entering a campaign that is already running
      )
    );
  }

  async getSyntheticTestRuns(campaignId: number, limit = 50): Promise<SyntheticTestRun[]> {
    return db.select().from(syntheticTestRuns)
      .where(eq(syntheticTestRuns.campaignId, campaignId))
      .orderBy(desc(syntheticTestRuns.startedAt))
      .limit(limit);
  }

  async addSyntheticTestRun(run: InsertSyntheticTestRun): Promise<SyntheticTestRun> {
    const [row] = await db.insert(syntheticTestRuns).values(run).returning();
    return row;
  }

  // ── Route Decision Traces ─────────────────────────────────────────────────
  async addRouteDecisionTrace(trace: InsertRouteDecisionTrace): Promise<RouteDecisionTrace> {
    const [row] = await db.insert(routeDecisionTraces).values(trace).returning();
    return row;
  }

  async getRouteDecisionTraces({ campaignId, limit = 200 }: { campaignId?: number; limit?: number }): Promise<RouteDecisionTrace[]> {
    const { and, eq: deq } = await import('drizzle-orm');
    const q = db.select().from(routeDecisionTraces);
    if (campaignId != null) {
      return q.where(deq(routeDecisionTraces.campaignId, campaignId))
        .orderBy(desc(routeDecisionTraces.createdAt)).limit(limit);
    }
    return q.orderBy(desc(routeDecisionTraces.createdAt)).limit(limit);
  }

  // ── Carrier Quality Scores ────────────────────────────────────────────────
  async getCarrierQualityScores(windowHours = 24): Promise<CarrierQualityScore[]> {
    return db.select().from(carrierQualityScores)
      .where(eq(carrierQualityScores.windowHours, windowHours))
      .orderBy(desc(carrierQualityScores.stabilityScore));
  }

  // ── Scheduled Reports ─────────────────────────────────────────────────────
  async getScheduledReports(): Promise<ScheduledReport[]> {
    return db.select().from(scheduledReports).orderBy(desc(scheduledReports.createdAt));
  }

  async createScheduledReport(report: InsertScheduledReport): Promise<ScheduledReport> {
    const nextDueAt = computeNextDueAt(report.frequency, report.cronHour as any);
    const [row] = await db.insert(scheduledReports).values({ ...report, nextDueAt }).returning();
    return row;
  }

  async updateScheduledReport(id: number, updates: Partial<InsertScheduledReport>): Promise<ScheduledReport | undefined> {
    const [row] = await db.update(scheduledReports).set(updates).where(eq(scheduledReports.id, id)).returning();
    return row;
  }

  async deleteScheduledReport(id: number): Promise<void> {
    await db.delete(scheduledReports).where(eq(scheduledReports.id, id));
  }

  async markReportSent(id: number, sentAt: Date, nextDueAt: Date): Promise<void> {
    await db.update(scheduledReports).set({ lastSentAt: sentAt, nextDueAt }).where(eq(scheduledReports.id, id));
  }

  async getDueScheduledReports(): Promise<ScheduledReport[]> {
    const now = new Date();
    return db.select().from(scheduledReports)
      .where(and(eq(scheduledReports.enabled, true), lt(scheduledReports.nextDueAt, now)));
  }

  // ── Reconciliation Report Schedules ──────────────────────────────────────────
  async getReconciliationReportSchedules(): Promise<ReconciliationReportSchedule[]> {
    return db.select().from(reconciliationReportSchedules).orderBy(desc(reconciliationReportSchedules.createdAt));
  }

  async createReconciliationReportSchedule(s: InsertReconciliationReportSchedule): Promise<ReconciliationReportSchedule> {
    const nextDueAt = computeReconNextDueAt(s.frequency ?? 'monthly', s.dayOfMonth ?? 1, s.dayOfWeek ?? undefined, s.cronHour ?? 8);
    const [row] = await db.insert(reconciliationReportSchedules).values({ ...s, nextDueAt }).returning();
    return row;
  }

  async updateReconciliationReportSchedule(id: number, updates: Partial<InsertReconciliationReportSchedule>): Promise<ReconciliationReportSchedule | undefined> {
    const extra: Partial<ReconciliationReportSchedule> = {};
    if (updates.frequency || updates.dayOfMonth != null || updates.dayOfWeek != null || updates.cronHour != null) {
      const existing = await db.select().from(reconciliationReportSchedules).where(eq(reconciliationReportSchedules.id, id)).then(r => r[0]);
      if (existing) {
        extra.nextDueAt = computeReconNextDueAt(
          updates.frequency ?? existing.frequency,
          updates.dayOfMonth ?? existing.dayOfMonth ?? 1,
          (updates.dayOfWeek !== undefined ? updates.dayOfWeek : existing.dayOfWeek) ?? undefined,
          updates.cronHour ?? existing.cronHour,
        );
      }
    }
    const [row] = await db.update(reconciliationReportSchedules)
      .set({ ...updates, ...extra })
      .where(eq(reconciliationReportSchedules.id, id))
      .returning();
    return row;
  }

  async deleteReconciliationReportSchedule(id: number): Promise<void> {
    await db.delete(reconciliationReportSchedules).where(eq(reconciliationReportSchedules.id, id));
  }

  async markReconciliationReportSent(id: number, sentAt: Date, nextDueAt: Date): Promise<void> {
    await db.update(reconciliationReportSchedules).set({ lastSentAt: sentAt, nextDueAt }).where(eq(reconciliationReportSchedules.id, id));
  }

  async getDueReconciliationReportSchedules(): Promise<ReconciliationReportSchedule[]> {
    const now = new Date();
    return db.select().from(reconciliationReportSchedules)
      .where(and(eq(reconciliationReportSchedules.enabled, true), lt(reconciliationReportSchedules.nextDueAt, now)));
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  async getChatRooms(): Promise<ChatRoom[]> {
    return db.select().from(chatRooms).orderBy(chatRooms.id);
  }

  async getChatRoom(slug: string): Promise<ChatRoom | undefined> {
    const [row] = await db.select().from(chatRooms).where(eq(chatRooms.slug, slug));
    return row;
  }

  async createChatRoom(room: InsertChatRoom): Promise<ChatRoom> {
    const [row] = await db.insert(chatRooms).values(room).returning();
    return row;
  }

  async getChatMessages(roomId: number, limit = 100): Promise<ChatMessage[]> {
    const rows = await db.select().from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  async createChatMessage(msg: InsertChatMessage): Promise<ChatMessage> {
    const [row] = await db.insert(chatMessages).values(msg).returning();
    return row;
  }

  async ensureDefaultChatRooms(): Promise<void> {
    const defaults: InsertChatRoom[] = [
      { name: 'General',       type: 'group', slug: 'general'       },
      { name: 'NOC Team',      type: 'group', slug: 'noc-team'      },
      { name: 'Announcements', type: 'group', slug: 'announcements' },
    ];
    for (const room of defaults) {
      const existing = await this.getChatRoom(room.slug);
      if (!existing) await this.createChatRoom(room);
    }
  }

  // ── Product Documents ─────────────────────────────────────────────────────

  async getProductDocs(productPrefix?: string): Promise<ProductDoc[]> {
    if (productPrefix) {
      return db.select().from(productDocs)
        .where(eq(productDocs.productPrefix, productPrefix))
        .orderBy(productDocs.sortOrder, productDocs.createdAt);
    }
    return db.select().from(productDocs).orderBy(productDocs.productPrefix, productDocs.sortOrder, productDocs.createdAt);
  }

  async getProductDoc(id: number): Promise<ProductDoc | undefined> {
    const [row] = await db.select().from(productDocs).where(eq(productDocs.id, id));
    return row;
  }

  async createProductDoc(doc: InsertProductDoc): Promise<ProductDoc> {
    const [created] = await db.insert(productDocs).values({ ...doc, updatedAt: new Date() }).returning();
    return created;
  }

  async updateProductDoc(id: number, patch: Partial<InsertProductDoc>): Promise<ProductDoc> {
    const [updated] = await db.update(productDocs)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(productDocs.id, id))
      .returning();
    return updated;
  }

  async deleteProductDoc(id: number): Promise<void> {
    await db.delete(productDocs).where(eq(productDocs.id, id));
  }

  // ── Approval Workflow ─────────────────────────────────────────────────────

  async createApprovalRequest(data: InsertApprovalRequest): Promise<ApprovalRequest> {
    const [created] = await db.insert(approvalRequests).values(data).returning();
    return created;
  }

  async getApprovalRequests(opts: { userId: string; role: Role; teamId?: string | null; status?: string }): Promise<ApprovalRequest[]> {
    const { role, teamId, status } = opts;
    let query = db.select().from(approvalRequests);
    const conditions: any[] = [];
    if (status) conditions.push(eq(approvalRequests.status, status));

    if (role === 'super_admin' || role === 'admin') {
      // see all requests
    } else if (role === 'team_lead' && teamId) {
      conditions.push(eq(approvalRequests.teamId, teamId));
    } else {
      // noc_operator / management / viewer: see only own submissions
      conditions.push(eq(approvalRequests.requestedBy, opts.userId));
    }

    const rows = conditions.length > 0
      ? await db.select().from(approvalRequests).where(and(...conditions)).orderBy(desc(approvalRequests.requestedAt))
      : await db.select().from(approvalRequests).orderBy(desc(approvalRequests.requestedAt));
    return rows;
  }

  async getApprovalRequestById(id: number): Promise<ApprovalRequest | null> {
    const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    return row ?? null;
  }

  async updateApprovalRequest(id: number, updates: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const [updated] = await db.update(approvalRequests).set(updates).where(eq(approvalRequests.id, id)).returning();
    return updated;
  }

  async addApprovalAuditEntry(entry: Omit<ApprovalAuditEntry, 'id' | 'createdAt'>): Promise<void> {
    await db.insert(approvalAuditLog).values(entry);
  }

  async getApprovalAuditLog(requestId: number): Promise<ApprovalAuditEntry[]> {
    return await db.select().from(approvalAuditLog)
      .where(eq(approvalAuditLog.requestId, requestId))
      .orderBy(desc(approvalAuditLog.createdAt));
  }

  async getPendingApprovalCount(opts: { userId: string; role: Role; teamId?: string | null }): Promise<number> {
    const { role, teamId } = opts;
    const conditions: any[] = [eq(approvalRequests.status, 'pending')];

    if (role === 'super_admin' || role === 'admin') {
      // count all pending
    } else if (role === 'team_lead' && teamId) {
      conditions.push(eq(approvalRequests.teamId, teamId));
    } else {
      return 0; // noc_operator, management, viewer: no approvals to take action on
    }

    const [row] = await db.select({ count: sql<number>`count(*)` })
      .from(approvalRequests)
      .where(and(...conditions));
    return Number(row?.count ?? 0);
  }

  // ── Portal Access Tokens ──────────────────────────────────────────────────────

  async createPortalToken(data: InsertPortalToken): Promise<PortalToken> {
    const [row] = await db.insert(portalAccessTokens).values(data).returning();
    return row;
  }

  async listPortalTokens(): Promise<PortalToken[]> {
    return db.select().from(portalAccessTokens).orderBy(desc(portalAccessTokens.createdAt));
  }

  async getPortalToken(token: string): Promise<PortalToken | undefined> {
    const [row] = await db.select().from(portalAccessTokens).where(eq(portalAccessTokens.token, token));
    return row;
  }

  async deletePortalToken(id: number): Promise<void> {
    await db.delete(portalAccessTokens).where(eq(portalAccessTokens.id, id));
  }

  async touchPortalToken(id: number): Promise<void> {
    await db.update(portalAccessTokens).set({ lastUsedAt: new Date() }).where(eq(portalAccessTokens.id, id));
  }

  // ── GDPR / Compliance ────────────────────────────────────────────────────────

  async getDeletionRequests(): Promise<DeletionRequest[]> {
    return db.select().from(deletionRequests).orderBy(desc(deletionRequests.requestedAt));
  }

  async getDeletionRequest(id: number): Promise<DeletionRequest | null> {
    const [row] = await db.select().from(deletionRequests).where(eq(deletionRequests.id, id));
    return row ?? null;
  }

  async createDeletionRequest(req: InsertDeletionRequest): Promise<DeletionRequest> {
    const [row] = await db.insert(deletionRequests).values(req).returning();
    return row;
  }

  async updateDeletionRequest(id: number, updates: Partial<DeletionRequest>): Promise<DeletionRequest> {
    const [row] = await db.update(deletionRequests)
      .set(updates).where(eq(deletionRequests.id, id)).returning();
    return row;
  }

  async getDataRetentionPolicies(): Promise<DataRetentionPolicy[]> {
    return db.select().from(dataRetentionPolicy).orderBy(dataRetentionPolicy.dataType);
  }

  async updateDataRetentionPolicy(dataType: string, updates: Partial<DataRetentionPolicy>): Promise<void> {
    await db.update(dataRetentionPolicy)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dataRetentionPolicy.dataType, dataType));
  }

  async seedDefaultRetentionPolicies(): Promise<void> {
    const defaults = [
      { dataType: 'fas_events',    label: 'FAS / Fraud Events',           retentionDays: 90  },
      { dataType: 'number_lookup', label: 'Number Intelligence Cache',     retentionDays: 30  },
      { dataType: 'audit_log',     label: 'Approval Audit Log',            retentionDays: 365 },
    ];
    for (const d of defaults) {
      const existing = await db.select().from(dataRetentionPolicy)
        .where(eq(dataRetentionPolicy.dataType, d.dataType));
      if (!existing.length) await db.insert(dataRetentionPolicy).values(d);
    }
  }

  // ── Per-account local config ──────────────────────────────────────────────────

  async getAccountConfig(iAccount: number): Promise<Record<string, any>> {
    try {
      const [row] = await db.select().from(accountConfigs).where(eq(accountConfigs.iAccount, iAccount));
      if (!row) return {};
      return JSON.parse(row.configJson);
    } catch { return {}; }
  }

  async saveAccountConfig(iAccount: number, section: string, data: Record<string, any>): Promise<void> {
    const existing = await this.getAccountConfig(iAccount);
    const merged = { ...existing, [section]: data };
    const jsonStr = JSON.stringify(merged);
    await db.execute(sql`
      INSERT INTO account_configs (i_account, config_json, updated_at)
      VALUES (${iAccount}, ${jsonStr}, NOW())
      ON CONFLICT (i_account) DO UPDATE SET config_json = ${jsonStr}, updated_at = NOW()
    `);
  }

  // ── Account Management — Companies ──────────────────────────────────────────

  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(companies.name);
  }

  async getCompanyBySippyAccount(iAccount: number): Promise<Company | null> {
    const [row] = await db.select().from(companies).where(eq(companies.sippyIAccount, iAccount));
    return row ?? null;
  }

  async getCompany(id: number): Promise<Company | null> {
    const [row] = await db.select().from(companies).where(eq(companies.id, id));
    return row ?? null;
  }

  async createCompany(data: InsertCompany, contacts: any[], bankAccounts: any[]): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    if (contacts.length) {
      const validContacts = contacts.filter(c => c.firstName?.trim() || c.email?.trim());
      if (validContacts.length) {
        await db.insert(companyContacts).values(
          validContacts.map(c => ({ ...c, companyId: company.id }))
        );
      }
    }
    if (bankAccounts.length) {
      const validBanks = bankAccounts.filter(b => b.bankName?.trim() && b.accountNo?.trim());
      if (validBanks.length) {
        await db.insert(companyBankAccounts).values(
          validBanks.map(b => ({ ...b, companyId: company.id }))
        );
      }
    }
    return company;
  }

  async updateCompany(id: number, updates: Partial<InsertCompany>): Promise<Company> {
    const [row] = await db.update(companies).set(updates).where(eq(companies.id, id)).returning();
    return row;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companyContacts).where(eq(companyContacts.companyId, id));
    await db.delete(companyBankAccounts).where(eq(companyBankAccounts.companyId, id));
    await db.delete(companies).where(eq(companies.id, id));
  }

  // ── Account Management — Client IP Requests ──────────────────────────────────

  async getClientIpRequests(companyId?: number): Promise<ClientIpRequest[]> {
    if (companyId) {
      return db.select().from(clientIpRequests)
        .where(eq(clientIpRequests.companyId, companyId))
        .orderBy(desc(clientIpRequests.submittedAt));
    }
    return db.select().from(clientIpRequests).orderBy(desc(clientIpRequests.submittedAt));
  }

  async findClientIpRequest(ipAddress: string, clientName: string): Promise<ClientIpRequest | null> {
    const [row] = await db.select().from(clientIpRequests)
      .where(and(
        eq(clientIpRequests.ipAddress, ipAddress),
        eq(clientIpRequests.clientName, clientName),
      ));
    return row ?? null;
  }

  async createClientIpRequest(data: InsertClientIpRequest): Promise<ClientIpRequest> {
    const [row] = await db.insert(clientIpRequests).values(data).returning();
    return row;
  }

  async updateClientIpRequest(id: number, updates: Partial<ClientIpRequest>): Promise<ClientIpRequest> {
    const [row] = await db.update(clientIpRequests).set(updates).where(eq(clientIpRequests.id, id)).returning();
    return row;
  }

  // ── Portal Ticket System (V1.1) ───────────────────────────────────────────
  async listPortalTickets(filter?: { accountId?: number; status?: string }): Promise<PortalTicket[]> {
    const conditions: any[] = [];
    if (filter?.accountId) conditions.push(eq(portalTickets.accountId, filter.accountId));
    if (filter?.status)    conditions.push(eq(portalTickets.status,    filter.status));
    const q = db.select().from(portalTickets).orderBy(desc(portalTickets.updatedAt));
    return conditions.length ? q.where(and(...conditions)) : q;
  }

  async getPortalTicket(id: number): Promise<PortalTicket | null> {
    const [row] = await db.select().from(portalTickets).where(eq(portalTickets.id, id));
    return row ?? null;
  }

  async createPortalTicket(data: InsertPortalTicket): Promise<PortalTicket> {
    const [row] = await db.insert(portalTickets).values(data).returning();
    return row;
  }

  async updatePortalTicketStatus(id: number, status: string): Promise<PortalTicket> {
    const [row] = await db.update(portalTickets)
      .set({ status, updatedAt: new Date() })
      .where(eq(portalTickets.id, id))
      .returning();
    return row;
  }

  async listTicketMessages(ticketId: number): Promise<PortalTicketMessage[]> {
    return db.select().from(portalTicketMessages)
      .where(eq(portalTicketMessages.ticketId, ticketId))
      .orderBy(asc(portalTicketMessages.createdAt));
  }

  async addTicketMessage(data: InsertPortalTicketMessage): Promise<PortalTicketMessage> {
    const [row] = await db.insert(portalTicketMessages).values(data).returning();
    if (data.ticketId) {
      await db.update(portalTickets).set({ updatedAt: new Date() }).where(eq(portalTickets.id, data.ticketId));
    }
    return row;
  }

  // ── Console Incidents (Phase 2) ────────────────────────────────────────────
  async upsertConsoleIncident(data: {
    entityKey: string; entityLabel: string; windowHash: string;
    severity: string; title: string; alertsJson: string;
    estimatedImpactPerHr: number | null; linkedTicketId: number | null;
    startedAt: Date; lastSeenAt: Date;
  }): Promise<ConsoleIncident> {
    // Try update first (preserve state/actions/timeline/rootCause on existing incidents)
    const existing = await db.select().from(consoleIncidents)
      .where(eq(consoleIncidents.windowHash, data.windowHash)).limit(1);
    if (existing.length > 0) {
      const [row] = await db.update(consoleIncidents)
        .set({
          severity:             data.severity,
          title:                data.title,
          alertsJson:           data.alertsJson,
          estimatedImpactPerHr: data.estimatedImpactPerHr,
          linkedTicketId:       data.linkedTicketId,
          lastSeenAt:           data.lastSeenAt,
          updatedAt:            new Date(),
        })
        .where(eq(consoleIncidents.windowHash, data.windowHash))
        .returning();
      return row;
    }
    const [row] = await db.insert(consoleIncidents).values({
      ...data, state: "active",
      alertsJson: data.alertsJson, timelineJson: "[]", actionsJson: "[]",
    }).returning();
    return row;
  }

  async listConsoleIncidents(): Promise<ConsoleIncident[]> {
    return db.select().from(consoleIncidents).orderBy(desc(consoleIncidents.lastSeenAt)).limit(100);
  }

  async getConsoleIncident(id: number): Promise<ConsoleIncident | null> {
    const rows = await db.select().from(consoleIncidents).where(eq(consoleIncidents.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async updateConsoleIncidentState(id: number, state: string, resolvedAt?: Date | null): Promise<ConsoleIncident> {
    const fields: any = { state, updatedAt: new Date() };
    if (resolvedAt !== undefined) fields.resolvedAt = resolvedAt;
    const [row] = await db.update(consoleIncidents).set(fields).where(eq(consoleIncidents.id, id)).returning();
    return row;
  }

  async updateConsoleIncidentFields(id: number, fields: Partial<ConsoleIncident>): Promise<ConsoleIncident> {
    const [row] = await db.update(consoleIncidents)
      .set({ ...fields, updatedAt: new Date() } as any)
      .where(eq(consoleIncidents.id, id))
      .returning();
    return row;
  }

  async addLifecycleEvent(data: { incidentId: number; fromState: string | null; toState: string; actor?: string; note?: string }): Promise<IncidentLifecycleEvent> {
    const [row] = await db.insert(incidentLifecycleEvents).values(data).returning();
    return row;
  }

  async listLifecycleEvents(incidentId: number): Promise<IncidentLifecycleEvent[]> {
    return db.select().from(incidentLifecycleEvents)
      .where(eq(incidentLifecycleEvents.incidentId, incidentId))
      .orderBy(asc(incidentLifecycleEvents.createdAt));
  }

  // ── Entity Presence Registry ──────────────────────────────────────────────────
  async loadEntityPresence(): Promise<{ dim: string; entityName: string; lastSeen: number; firstSeen: number; peakToday: number; peakTs: number }[]> {
    const rows = await db.select().from(entityPresenceRegistry);
    return rows.map(r => ({
      dim:        r.dim,
      entityName: r.entityName,
      lastSeen:   Number(r.lastSeen),
      firstSeen:  Number(r.firstSeen),
      peakToday:  r.peakToday,
      peakTs:     Number(r.peakTs),
    }));
  }

  async upsertEntityPresence(rows: { dim: string; entityName: string; lastSeen: number; firstSeen: number; peakToday: number; peakTs: number }[]): Promise<void> {
    if (!rows.length) return;
    for (const r of rows) {
      await db.insert(entityPresenceRegistry)
        .values({ dim: r.dim, entityName: r.entityName, lastSeen: r.lastSeen, firstSeen: r.firstSeen, peakToday: r.peakToday, peakTs: r.peakTs })
        .onConflictDoUpdate({
          target: [entityPresenceRegistry.dim, entityPresenceRegistry.entityName],
          set: {
            lastSeen:  r.lastSeen,
            peakToday: r.peakToday,
            peakTs:    r.peakTs,
            updatedAt: new Date(),
          },
        });
    }
  }

  // ── Concurrent Snapshot History ───────────────────────────────────────────────
  async insertConcurrentSnapshots(rows: { dim: string; entityName: string; ts: number; active: number; connected: number; routing: number }[]): Promise<void> {
    if (!rows.length) return;
    const chunks: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += 200) chunks.push(rows.slice(i, i + 200));
    for (const chunk of chunks) {
      await db.insert(concurrentSnapshots).values(
        chunk.map(r => ({ dim: r.dim, entityName: r.entityName, ts: r.ts, active: r.active, connected: r.connected, routing: r.routing }))
      );
    }
  }

  async queryConcurrentHistory(dim: string, entityName: string, fromTs: number, bucketMs: number): Promise<{ bucketTs: number; maxActive: number; avgActive: number; maxConnected: number; maxRouting: number }[]> {
    if (entityName === '__total__' || entityName === '') {
      // Fetch per-entity per-snapshot rows and bucket in JS.
      // Avoids all SQL GROUP BY expression-matching issues with Drizzle/pg parameterization.
      const pgResult = await pool.query(
        `SELECT ts, entity_name,
                MAX(active)    AS peak_active,
                MAX(connected) AS peak_connected,
                MAX(routing)   AS peak_routing
         FROM concurrent_snapshots
         WHERE dim = $1 AND ts >= $2
         GROUP BY ts, entity_name
         ORDER BY ts`,
        [dim, fromTs],
      );
      // JS bucketing: floor(ts / bucketMs) * bucketMs → sum entity peaks within bucket
      const entityBuckets = new Map<number, Map<string, { a: number; c: number; r: number }>>();
      for (const row of pgResult.rows as any[]) {
        const bk = Math.floor(Number(row.ts) / bucketMs) * bucketMs;
        if (!entityBuckets.has(bk)) entityBuckets.set(bk, new Map());
        const ent = entityBuckets.get(bk)!;
        const prev = ent.get(row.entity_name) ?? { a: 0, c: 0, r: 0 };
        ent.set(row.entity_name, {
          a: Math.max(prev.a, Number(row.peak_active   ?? 0)),
          c: Math.max(prev.c, Number(row.peak_connected ?? 0)),
          r: Math.max(prev.r, Number(row.peak_routing   ?? 0)),
        });
      }
      return [...entityBuckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bk, entities]) => {
          let maxActive = 0, sumConnected = 0, sumRouting = 0, count = 0;
          for (const v of entities.values()) { maxActive += v.a; sumConnected += v.c; sumRouting += v.r; count++; }
          return {
            bucketTs:     bk,
            maxActive,
            avgActive:    count > 0 ? Math.round(maxActive / count) : 0,
            maxConnected: sumConnected,
            maxRouting:   sumRouting,
          };
        });
    }

    const result = await db.execute(sql`
      SELECT
        (floor(ts::float8 / ${bucketMs}) * ${bucketMs})::bigint AS bucket_ts,
        MAX(active)::int    AS max_active,
        ROUND(AVG(active))::int AS avg_active,
        MAX(connected)::int AS max_connected,
        MAX(routing)::int   AS max_routing
      FROM concurrent_snapshots
      WHERE dim = ${dim} AND entity_name = ${entityName} AND ts >= ${fromTs}
      GROUP BY bucket_ts
      ORDER BY bucket_ts
    `);
    return (result.rows as any[]).map(r => ({
      bucketTs:     Number(r.bucket_ts),
      maxActive:    Number(r.max_active    ?? 0),
      avgActive:    Number(r.avg_active    ?? 0),
      maxConnected: Number(r.max_connected ?? 0),
      maxRouting:   Number(r.max_routing   ?? 0),
    }));
  }

  async pruneConcurrentSnapshots(): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    await db.delete(concurrentSnapshots).where(lt(concurrentSnapshots.ts, cutoff));
  }

  // ── SMTP Sender Profiles ─────────────────────────────────────────────────────
  async listSmtpSenderProfiles(): Promise<SmtpSenderProfile[]> {
    return db.select().from(smtpSenderProfiles).orderBy(smtpSenderProfiles.communicationType, smtpSenderProfiles.name);
  }

  async getSmtpSenderProfile(id: number): Promise<SmtpSenderProfile | null> {
    const [row] = await db.select().from(smtpSenderProfiles).where(eq(smtpSenderProfiles.id, id));
    return row ?? null;
  }

  async createSmtpSenderProfile(data: InsertSmtpSenderProfile): Promise<SmtpSenderProfile> {
    const [row] = await db.insert(smtpSenderProfiles).values(data).returning();
    return row;
  }

  async updateSmtpSenderProfile(id: number, updates: Partial<SmtpSenderProfile>): Promise<SmtpSenderProfile> {
    const [row] = await db.update(smtpSenderProfiles)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(smtpSenderProfiles.id, id))
      .returning();
    return row;
  }

  async deleteSmtpSenderProfile(id: number): Promise<void> {
    await db.delete(smtpSenderProfiles).where(eq(smtpSenderProfiles.id, id));
  }

  // ── Commercial Notifications ─────────────────────────────────────────────────
  async listCommercialNotifications(): Promise<CommercialNotification[]> {
    return db.select().from(commercialNotifications).orderBy(desc(commercialNotifications.createdAt));
  }

  async getCommercialNotification(id: number): Promise<CommercialNotification | null> {
    const [row] = await db.select().from(commercialNotifications).where(eq(commercialNotifications.id, id));
    return row ?? null;
  }

  async createCommercialNotification(data: InsertCommercialNotification): Promise<CommercialNotification> {
    const [row] = await db.insert(commercialNotifications).values(data).returning();
    return row;
  }

  async updateCommercialNotification(id: number, updates: Partial<CommercialNotification>): Promise<CommercialNotification> {
    const [row] = await db.update(commercialNotifications).set(updates).where(eq(commercialNotifications.id, id)).returning();
    return row;
  }

  async deleteCommercialNotification(id: number): Promise<void> {
    await db.delete(commercialNotificationRecipients).where(eq(commercialNotificationRecipients.notificationId, id));
    await db.delete(commercialNotifications).where(eq(commercialNotifications.id, id));
  }

  async getCommercialNotificationRecipients(notificationId: number): Promise<CommercialNotificationRecipient[]> {
    return db.select().from(commercialNotificationRecipients)
      .where(eq(commercialNotificationRecipients.notificationId, notificationId))
      .orderBy(commercialNotificationRecipients.id);
  }

  async bulkInsertCommercialNotificationRecipients(rows: InsertCommercialNotificationRecipient[]): Promise<void> {
    if (!rows.length) return;
    await db.insert(commercialNotificationRecipients).values(rows);
  }

  async updateCommercialNotificationRecipient(id: number, updates: Partial<CommercialNotificationRecipient>): Promise<void> {
    await db.update(commercialNotificationRecipients).set(updates).where(eq(commercialNotificationRecipients.id, id));
  }

  // ── Daily Minutes Report (DMR) ────────────────────────────────────────────────
  async listDMRReports(opts: { reportDate?: string; fromDate?: string; toDate?: string; latestVersionOnly?: boolean; status?: string } = {}): Promise<DailyMinutesReport[]> {
    const conditions = [];
    if (opts.reportDate) conditions.push(eq(dailyMinutesReports.reportDate, opts.reportDate));
    if (opts.fromDate)   conditions.push(sql`${dailyMinutesReports.reportDate} >= ${opts.fromDate}`);
    if (opts.toDate)     conditions.push(sql`${dailyMinutesReports.reportDate} <= ${opts.toDate}`);
    if (opts.status)     conditions.push(eq(dailyMinutesReports.verificationStatus, opts.status));

    const q = db.select().from(dailyMinutesReports);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    const rows = await filtered.orderBy(desc(dailyMinutesReports.generatedAt));

    if (!opts.latestVersionOnly) return rows;

    // Keep only the latest version per report_date + account_id/vendor_id combination
    const latestMap = new Map<string, DailyMinutesReport>();
    for (const row of rows) {
      const key = `${row.reportDate}::${row.accountId ?? ''}::${row.vendorId ?? ''}::${row.accountName ?? ''}`;
      const existing = latestMap.get(key);
      if (!existing || row.dmrVersion > existing.dmrVersion) {
        latestMap.set(key, row);
      }
    }
    return Array.from(latestMap.values()).sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  }

  async getDMRReport(id: number): Promise<DailyMinutesReport | null> {
    const [row] = await db.select().from(dailyMinutesReports).where(eq(dailyMinutesReports.id, id));
    return row ?? null;
  }

  async bulkInsertDMRReports(rows: InsertDailyMinutesReport[]): Promise<DailyMinutesReport[]> {
    if (rows.length === 0) return [];
    return db.insert(dailyMinutesReports).values(rows).returning();
  }

  async updateDMRStatus(id: number, status: string): Promise<DailyMinutesReport | null> {
    const [row] = await db
      .update(dailyMinutesReports)
      .set({ verificationStatus: status })
      .where(eq(dailyMinutesReports.id, id))
      .returning();
    return row ?? null;
  }

  async hasDMRVerifiedForPeriod(fromDate: string, toDate: string): Promise<{ verified: boolean; missingDates: string[]; criticalDates: string[] }> {
    const rows = await this.listDMRReports({ fromDate, toDate, latestVersionOnly: true });

    // Build set of dates that have at least one verified row
    const verifiedDates   = new Set<string>();
    const criticalDates   = new Set<string>();
    for (const r of rows) {
      if (r.verificationStatus === 'verified' || r.verificationStatus === 'locked') {
        verifiedDates.add(r.reportDate);
      }
      if (r.verificationStatus === 'critical') {
        criticalDates.add(r.reportDate);
      }
    }

    // Enumerate every calendar day in the billing period
    const missingDates: string[] = [];
    const cur = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate   + 'T00:00:00Z');
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      if (!verifiedDates.has(d)) missingDates.push(d);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return {
      verified:      missingDates.length === 0 && criticalDates.size === 0,
      missingDates,
      criticalDates: [...criticalDates],
    };
  }

  // ── Partner Operations Portal ─────────────────────────────────────────────────────
  async createPartnerProfile(data: any): Promise<PartnerProfile> {
    const [row] = await db.insert(partnerProfiles).values(data).returning();
    return row;
  }
  async listPartnerProfiles(): Promise<PartnerProfile[]> {
    return db.select().from(partnerProfiles).orderBy(desc(partnerProfiles.createdAt));
  }
  async getPartnerProfileById(id: number): Promise<PartnerProfile | null> {
    const [row] = await db.select().from(partnerProfiles).where(eq(partnerProfiles.id, id));
    return row ?? null;
  }
  async getPartnerProfileByClientName(clientName: string): Promise<PartnerProfile | null> {
    const [row] = await db.select().from(partnerProfiles).where(eq(partnerProfiles.clientName, clientName));
    return row ?? null;
  }
  async findPartnerByCodePrefix(prefix: string): Promise<PartnerProfile[]> {
    return db.select().from(partnerProfiles).where(
      and(eq(partnerProfiles.accessCodePrefix, prefix), eq(partnerProfiles.active, true))
    );
  }
  async updatePartnerProfile(id: number, updates: Partial<PartnerProfile>): Promise<PartnerProfile> {
    const [row] = await db.update(partnerProfiles).set({ ...updates, updatedAt: new Date() } as any)
      .where(eq(partnerProfiles.id, id)).returning();
    return row;
  }
  async deletePartnerProfile(id: number): Promise<void> {
    await db.delete(partnerProfiles).where(eq(partnerProfiles.id, id));
  }

  // ── AI Revenue Assurance Layer ────────────────────────────────────────────────────
  async createAiAlert(data: InsertAiRevenueAlert): Promise<AiRevenueAlert> {
    const [row] = await db.insert(aiRevenueAlerts).values(data).returning();
    return row;
  }
  async listAiAlerts(opts: { status?: string; severity?: string; alertType?: string; clientName?: string; limit?: number } = {}): Promise<AiRevenueAlert[]> {
    const conditions = [];
    if (opts.status)     conditions.push(eq(aiRevenueAlerts.status,    opts.status));
    if (opts.severity)   conditions.push(eq(aiRevenueAlerts.severity,  opts.severity));
    if (opts.alertType)  conditions.push(eq(aiRevenueAlerts.alertType, opts.alertType));
    if (opts.clientName) conditions.push(eq(aiRevenueAlerts.clientName, opts.clientName));
    const q = db.select().from(aiRevenueAlerts);
    const result = (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(desc(aiRevenueAlerts.createdAt));
    return opts.limit ? result.limit(opts.limit) : result;
  }
  async updateAiAlert(id: number, updates: Partial<AiRevenueAlert>): Promise<AiRevenueAlert> {
    const [row] = await db.update(aiRevenueAlerts).set(updates as any).where(eq(aiRevenueAlerts.id, id)).returning();
    return row;
  }
  async createScanRun(data: Partial<InsertAiScanRun>): Promise<AiScanRun> {
    const [row] = await db.insert(aiScanRuns).values({ alertsCreated: 0, detectorsRan: 0, status: 'running', ...data }).returning();
    return row;
  }
  async listScanRuns(limit = 50): Promise<AiScanRun[]> {
    return db.select().from(aiScanRuns).orderBy(desc(aiScanRuns.startedAt)).limit(limit);
  }
  async updateScanRun(id: number, updates: Partial<AiScanRun>): Promise<AiScanRun> {
    const [row] = await db.update(aiScanRuns).set(updates as any).where(eq(aiScanRuns.id, id)).returning();
    return row;
  }
  async createLedgerEntry(data: InsertAdjustmentLedgerEntry): Promise<AdjustmentLedgerEntry> {
    const [row] = await db.insert(adjustmentLedger).values(data).returning();
    return row;
  }
  async listLedgerEntries(opts: { clientName?: string; referenceType?: string; referenceId?: string; limit?: number } = {}): Promise<AdjustmentLedgerEntry[]> {
    const conditions = [];
    if (opts.clientName)    conditions.push(eq(adjustmentLedger.clientName,    opts.clientName));
    if (opts.referenceType) conditions.push(eq(adjustmentLedger.referenceType, opts.referenceType));
    if (opts.referenceId)   conditions.push(eq(adjustmentLedger.referenceId,   opts.referenceId));
    const q = db.select().from(adjustmentLedger);
    const result = (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(desc(adjustmentLedger.createdAt));
    return opts.limit ? result.limit(opts.limit) : result;
  }

  // ── Multi-Template Invoice Rendering ─────────────────────────────────────────────
  async createInvoiceTemplate(data: InsertInvoiceTemplate): Promise<InvoiceTemplate> {
    const [row] = await db.insert(invoiceTemplates).values(data).returning();
    return row;
  }
  async getInvoiceTemplate(id: number): Promise<InvoiceTemplate | null> {
    const [row] = await db.select().from(invoiceTemplates).where(eq(invoiceTemplates.id, id));
    return row ?? null;
  }
  async listInvoiceTemplates(opts: { clientName?: string; isDefault?: boolean; templateType?: string } = {}): Promise<InvoiceTemplate[]> {
    const conditions = [];
    if (opts.clientName !== undefined) conditions.push(opts.clientName ? eq(invoiceTemplates.clientName, opts.clientName) : sql`${invoiceTemplates.clientName} IS NULL`);
    if (opts.isDefault !== undefined) conditions.push(eq(invoiceTemplates.isDefault, opts.isDefault));
    if (opts.templateType) conditions.push(eq(invoiceTemplates.templateType, opts.templateType));
    const q = db.select().from(invoiceTemplates);
    return (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(desc(invoiceTemplates.isDefault), invoiceTemplates.templateName);
  }
  async updateInvoiceTemplate(id: number, updates: Partial<InvoiceTemplate>): Promise<InvoiceTemplate> {
    const [row] = await db.update(invoiceTemplates).set(updates as any).where(eq(invoiceTemplates.id, id)).returning();
    return row;
  }
  async deleteInvoiceTemplate(id: number): Promise<void> {
    await db.delete(invoiceTemplates).where(eq(invoiceTemplates.id, id));
  }

  // ── Client Branding Profiles ──────────────────────────────────────────────────────
  async createBrandingProfile(data: InsertClientBrandingProfile): Promise<ClientBrandingProfile> {
    const [row] = await db.insert(clientBrandingProfiles).values(data).returning();
    return row;
  }
  async getBrandingProfile(id: number): Promise<ClientBrandingProfile | null> {
    const [row] = await db.select().from(clientBrandingProfiles).where(eq(clientBrandingProfiles.id, id));
    return row ?? null;
  }
  async listBrandingProfiles(opts: { clientName?: string; isGlobal?: boolean } = {}): Promise<ClientBrandingProfile[]> {
    const conditions = [];
    if (opts.clientName !== undefined) conditions.push(opts.clientName ? eq(clientBrandingProfiles.clientName, opts.clientName) : sql`${clientBrandingProfiles.clientName} IS NULL`);
    if (opts.isGlobal) conditions.push(sql`${clientBrandingProfiles.clientName} IS NULL`);
    const q = db.select().from(clientBrandingProfiles);
    return (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(clientBrandingProfiles.clientName);
  }
  async updateBrandingProfile(id: number, updates: Partial<ClientBrandingProfile>): Promise<ClientBrandingProfile> {
    const [row] = await db.update(clientBrandingProfiles).set(updates as any).where(eq(clientBrandingProfiles.id, id)).returning();
    return row;
  }
  async deleteBrandingProfile(id: number): Promise<void> {
    await db.delete(clientBrandingProfiles).where(eq(clientBrandingProfiles.id, id));
  }

  // ── Credit Notes & Settlement Engine ─────────────────────────────────────────────
  async createCreditNote(data: InsertCreditNote): Promise<CreditNote> {
    const [row] = await db.insert(creditNotes).values(data).returning();
    return row;
  }
  async getCreditNote(id: number): Promise<CreditNote | null> {
    const [row] = await db.select().from(creditNotes).where(eq(creditNotes.id, id));
    return row ?? null;
  }
  async listCreditNotes(opts: { status?: string; clientName?: string; year?: string } = {}): Promise<CreditNote[]> {
    const conditions = [];
    if (opts.status)     conditions.push(eq(creditNotes.status, opts.status));
    if (opts.clientName) conditions.push(eq(creditNotes.clientName, opts.clientName));
    if (opts.year)       conditions.push(sql`EXTRACT(YEAR FROM ${creditNotes.createdAt}) = ${parseInt(opts.year)}`);
    const q = db.select().from(creditNotes);
    return (conditions.length > 0 ? q.where(and(...conditions)) : q).orderBy(desc(creditNotes.createdAt));
  }
  async updateCreditNote(id: number, updates: Partial<CreditNote>): Promise<CreditNote> {
    const [row] = await db.update(creditNotes).set(updates as any).where(eq(creditNotes.id, id)).returning();
    return row;
  }

  // ── Collections & Credit Control ──────────────────────────────────────────────────
  async createCreditControlRule(data: InsertCreditControlRule): Promise<CreditControlRule> {
    const [row] = await db.insert(creditControlRules).values(data).returning();
    return row;
  }
  async getCreditControlRuleByClient(clientName: string): Promise<CreditControlRule | null> {
    const [row] = await db.select().from(creditControlRules)
      .where(and(eq(creditControlRules.clientName, clientName), eq(creditControlRules.isGlobal, false)));
    return row ?? null;
  }
  async getGlobalCreditControlRule(): Promise<CreditControlRule | null> {
    const [row] = await db.select().from(creditControlRules).where(eq(creditControlRules.isGlobal, true));
    return row ?? null;
  }
  async listCreditControlRules(opts: { isGlobal?: boolean } = {}): Promise<CreditControlRule[]> {
    const q = db.select().from(creditControlRules);
    if (opts.isGlobal !== undefined) return q.where(eq(creditControlRules.isGlobal, opts.isGlobal)).orderBy(creditControlRules.clientName);
    return q.orderBy(desc(creditControlRules.isGlobal), creditControlRules.clientName);
  }
  async updateCreditControlRule(id: number, updates: Partial<CreditControlRule>): Promise<CreditControlRule> {
    const [row] = await db.update(creditControlRules).set(updates as any).where(eq(creditControlRules.id, id)).returning();
    return row;
  }
  async createCollectionEvent(data: InsertCollectionEvent): Promise<CollectionEvent> {
    const [row] = await db.insert(collectionEvents).values(data).returning();
    return row;
  }
  async listCollectionEvents(opts: { clientName?: string; eventType?: string; limit?: number } = {}): Promise<CollectionEvent[]> {
    const conditions = [];
    if (opts.clientName) conditions.push(eq(collectionEvents.clientName, opts.clientName));
    if (opts.eventType)  conditions.push(eq(collectionEvents.eventType, opts.eventType));
    const q = db.select().from(collectionEvents);
    const result = conditions.length > 0 ? q.where(and(...conditions)) : q;
    const ordered = result.orderBy(desc(collectionEvents.createdAt));
    return opts.limit ? ordered.limit(opts.limit) : ordered;
  }
  async updateCollectionEvent(id: number, updates: Partial<CollectionEvent>): Promise<CollectionEvent> {
    const [row] = await db.update(collectionEvents).set(updates as any).where(eq(collectionEvents.id, id)).returning();
    return row;
  }

  // ── Invoice Delivery Automation ────────────────────────────────────────────────
  async createInvoiceJob(data: InsertInvoiceJob): Promise<InvoiceJob> {
    const [row] = await db.insert(invoiceJobs).values(data).returning();
    return row;
  }

  async getInvoiceJob(id: number): Promise<InvoiceJob | null> {
    const [row] = await db.select().from(invoiceJobs).where(eq(invoiceJobs.id, id));
    return row ?? null;
  }

  async listInvoiceJobs(opts: { status?: string; clientName?: string; billingPeriod?: string } = {}): Promise<InvoiceJob[]> {
    const conditions = [];
    if (opts.status)        conditions.push(eq(invoiceJobs.status, opts.status));
    if (opts.clientName)    conditions.push(eq(invoiceJobs.clientName, opts.clientName));
    if (opts.billingPeriod) conditions.push(eq(invoiceJobs.billingPeriod, opts.billingPeriod));
    const q = db.select().from(invoiceJobs);
    const result = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return result.orderBy(desc(invoiceJobs.createdAt));
  }

  async updateInvoiceJob(id: number, updates: Partial<InvoiceJob>): Promise<InvoiceJob> {
    const [row] = await db.update(invoiceJobs).set(updates as any).where(eq(invoiceJobs.id, id)).returning();
    return row;
  }

  // ── Formal Dispute Workflow ────────────────────────────────────────────────────
  async createDisputeCase(data: InsertDisputeCase): Promise<DisputeCase> {
    const [row] = await db.insert(disputeCases).values(data).returning();
    return row;
  }

  async getDisputeCase(id: number): Promise<DisputeCase | null> {
    const [row] = await db.select().from(disputeCases).where(eq(disputeCases.id, id));
    return row ?? null;
  }

  async listDisputeCases(opts: { status?: string; clientName?: string; severity?: string; year?: string } = {}): Promise<DisputeCase[]> {
    const conditions = [];
    if (opts.status)     conditions.push(eq(disputeCases.status, opts.status));
    if (opts.clientName) conditions.push(eq(disputeCases.clientName, opts.clientName));
    if (opts.severity)   conditions.push(eq(disputeCases.severity, opts.severity));
    if (opts.year)       conditions.push(sql`EXTRACT(YEAR FROM ${disputeCases.createdAt}) = ${parseInt(opts.year)}`);
    const q = db.select().from(disputeCases);
    const result = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return result.orderBy(desc(disputeCases.openedAt));
  }

  async updateDisputeCase(id: number, updates: Partial<DisputeCase>): Promise<DisputeCase> {
    const [row] = await db.update(disputeCases).set(updates as any).where(eq(disputeCases.id, id)).returning();
    return row;
  }

  async addDisputeCaseEvent(data: InsertDisputeCaseEvent): Promise<DisputeCaseEvent> {
    const [row] = await db.insert(disputeCaseEvents).values(data).returning();
    return row;
  }

  async listDisputeCaseEvents(caseId: number): Promise<DisputeCaseEvent[]> {
    return db.select().from(disputeCaseEvents)
      .where(eq(disputeCaseEvents.caseId, caseId))
      .orderBy(disputeCaseEvents.createdAt);
  }

  // ── Margin Intelligence ────────────────────────────────────────────────────────
  async deleteMarginAnalyticsForDate(date: string): Promise<void> {
    await db.delete(marginAnalyticsDaily).where(eq(marginAnalyticsDaily.date, date));
  }

  async bulkInsertMarginAnalytics(rows: InsertMarginAnalyticsDaily[]): Promise<MarginAnalyticsDaily[]> {
    if (rows.length === 0) return [];
    return db.insert(marginAnalyticsDaily).values(rows).returning();
  }

  async getMarginAnalytics(opts: { date?: string; fromDate?: string; toDate?: string; dimensionType?: string; dimensionName?: string } = {}): Promise<MarginAnalyticsDaily[]> {
    const conditions = [];
    if (opts.date)          conditions.push(eq(marginAnalyticsDaily.date, opts.date));
    if (opts.fromDate)      conditions.push(sql`${marginAnalyticsDaily.date} >= ${opts.fromDate}`);
    if (opts.toDate)        conditions.push(sql`${marginAnalyticsDaily.date} <= ${opts.toDate}`);
    if (opts.dimensionType) conditions.push(eq(marginAnalyticsDaily.dimensionType, opts.dimensionType));
    if (opts.dimensionName) conditions.push(eq(marginAnalyticsDaily.dimensionName, opts.dimensionName));
    const q = db.select().from(marginAnalyticsDaily);
    return conditions.length > 0 ? q.where(and(...conditions)) : q;
  }

  async bulkInsertMarginAlerts(alerts: InsertMarginAlert[]): Promise<MarginAlert[]> {
    if (alerts.length === 0) return [];
    return db.insert(marginAlerts).values(alerts).returning();
  }

  async listMarginAlerts(opts: { unacknowledged?: boolean; date?: string; severity?: string } = {}): Promise<MarginAlert[]> {
    const conditions = [];
    if (opts.unacknowledged) conditions.push(eq(marginAlerts.acknowledged, false));
    if (opts.date)           conditions.push(eq(marginAlerts.date, opts.date));
    if (opts.severity)       conditions.push(eq(marginAlerts.severity, opts.severity));
    const q = db.select().from(marginAlerts);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered.orderBy(desc(marginAlerts.triggeredAt));
  }

  async updateMarginAlert(id: number, updates: Partial<MarginAlert>): Promise<MarginAlert> {
    const [row] = await db.update(marginAlerts).set(updates).where(eq(marginAlerts.id, id)).returning();
    return row;
  }

  // ── Acknowledgement Tracking ───────────────────────────────────────────────────
  async findRecipientByToken(token: string): Promise<CommercialNotificationRecipient | null> {
    const [row] = await db.select().from(commercialNotificationRecipients)
      .where(eq(commercialNotificationRecipients.trackingToken, token));
    return row ?? null;
  }

  async updateRecipientByToken(token: string, updates: Partial<CommercialNotificationRecipient>): Promise<void> {
    await db.update(commercialNotificationRecipients).set(updates)
      .where(eq(commercialNotificationRecipients.trackingToken, token));
  }

  // ── Client Revenue Reconciliation ────────────────────────────────────────────
  async listClientReconciliations(opts: { billingPeriod?: string; clientAccountId?: string; status?: string; severity?: string; latestVersionOnly?: boolean } = {}): Promise<ClientRevenueReconciliation[]> {
    const conditions = [];
    if (opts.billingPeriod)   conditions.push(eq(clientRevenueReconciliations.billingPeriod, opts.billingPeriod));
    if (opts.status)          conditions.push(eq(clientRevenueReconciliations.status, opts.status));
    if (opts.severity)        conditions.push(eq(clientRevenueReconciliations.severity, opts.severity));
    if (opts.clientAccountId) {
      conditions.push(
        sql`(${clientRevenueReconciliations.clientAccountId} = ${opts.clientAccountId} OR ${clientRevenueReconciliations.clientName} = ${opts.clientAccountId})`
      );
    }
    const q = db.select().from(clientRevenueReconciliations);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    const rows = await filtered.orderBy(desc(clientRevenueReconciliations.createdAt));
    if (!opts.latestVersionOnly) return rows;

    // Keep only latest version per billing_period + client identity
    const latestMap = new Map<string, ClientRevenueReconciliation>();
    for (const row of rows) {
      const key = `${row.billingPeriod}::${row.clientAccountId ?? ''}::${row.clientName}`;
      const existing = latestMap.get(key);
      if (!existing || row.version > existing.version) latestMap.set(key, row);
    }
    return Array.from(latestMap.values()).sort((a, b) =>
      a.clientName.localeCompare(b.clientName)
    );
  }

  async getClientReconciliation(id: number): Promise<ClientRevenueReconciliation | null> {
    const [row] = await db.select().from(clientRevenueReconciliations).where(eq(clientRevenueReconciliations.id, id));
    return row ?? null;
  }

  async createClientReconciliation(data: InsertClientRevenueReconciliation): Promise<ClientRevenueReconciliation> {
    const [row] = await db.insert(clientRevenueReconciliations).values(data).returning();
    return row;
  }

  async updateClientReconciliation(id: number, updates: Partial<ClientRevenueReconciliation>): Promise<ClientRevenueReconciliation> {
    const [row] = await db.update(clientRevenueReconciliations).set(updates).where(eq(clientRevenueReconciliations.id, id)).returning();
    return row;
  }

  // ── Communication Policies Engine ────────────────────────────────────────────
  async listCommunicationPolicies(opts: { enabled?: boolean; triggerType?: string } = {}): Promise<CommunicationPolicy[]> {
    const conditions = [];
    if (opts.enabled !== undefined) conditions.push(eq(communicationPolicies.enabled, opts.enabled));
    if (opts.triggerType)           conditions.push(eq(communicationPolicies.triggerType, opts.triggerType));
    const q = db.select().from(communicationPolicies);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered.orderBy(asc(communicationPolicies.id));
  }

  async getCommunicationPolicy(id: number): Promise<CommunicationPolicy | null> {
    const [row] = await db.select().from(communicationPolicies).where(eq(communicationPolicies.id, id));
    return row ?? null;
  }

  async createCommunicationPolicy(data: InsertCommunicationPolicy): Promise<CommunicationPolicy> {
    const [row] = await db.insert(communicationPolicies).values(data).returning();
    return row;
  }

  async updateCommunicationPolicy(id: number, updates: Partial<CommunicationPolicy>): Promise<CommunicationPolicy> {
    const [row] = await db.update(communicationPolicies).set(updates).where(eq(communicationPolicies.id, id)).returning();
    return row;
  }

  async deleteCommunicationPolicy(id: number): Promise<void> {
    await db.delete(communicationPolicies).where(eq(communicationPolicies.id, id));
  }

  // ── Layer 5A — Executive Report Jobs ─────────────────────────────────────────
  async createReportJob(data: InsertReportJob): Promise<ReportJob> {
    const [row] = await db.insert(reportJobs).values(data).returning();
    return row;
  }

  async getReportJob(id: number): Promise<ReportJob | null> {
    const [row] = await db.select().from(reportJobs).where(eq(reportJobs.id, id));
    return row ?? null;
  }

  async listReportJobs(opts: { limit?: number } = {}): Promise<ReportJob[]> {
    return db.select().from(reportJobs)
      .orderBy(desc(reportJobs.createdAt))
      .limit(opts.limit ?? 50);
  }

  async updateReportJob(id: number, updates: Partial<ReportJob>): Promise<ReportJob> {
    const [row] = await db.update(reportJobs).set(updates).where(eq(reportJobs.id, id)).returning();
    return row;
  }

  // ── Layer 5B — Invoices ───────────────────────────────────────────────────────
  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    const [row] = await db.insert(invoices).values(data).returning();
    return row;
  }

  async getInvoice(id: number): Promise<Invoice | null> {
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
    return row ?? null;
  }

  async listInvoices(opts: { status?: string; iTariff?: string; limit?: number } = {}): Promise<Invoice[]> {
    const conditions = [];
    if (opts.status)  conditions.push(eq(invoices.status,  opts.status));
    if (opts.iTariff) conditions.push(eq(invoices.iTariff, opts.iTariff));
    const q = db.select().from(invoices);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered.orderBy(desc(invoices.createdAt)).limit(opts.limit ?? 100);
  }

  async updateInvoice(id: number, updates: Partial<Invoice>): Promise<Invoice> {
    const [row] = await db.update(invoices).set(updates).where(eq(invoices.id, id)).returning();
    return row;
  }

  async countInvoices(): Promise<number> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(invoices);
    return count ?? 0;
  }

  async bulkCreateInvoiceLineItems(items: InsertInvoiceLineItem[]): Promise<void> {
    if (items.length === 0) return;
    await db.insert(invoiceLineItems).values(items);
  }

  async listInvoiceLineItems(invoiceId: number): Promise<InvoiceLineItem[]> {
    return db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(asc(invoiceLineItems.id))
      .limit(50000);
  }

  async createInvoiceEmailDelivery(data: InsertInvoiceEmailDelivery): Promise<InvoiceEmailDelivery> {
    const [row] = await db.insert(invoiceEmailDeliveries).values(data).returning();
    return row;
  }

  async listInvoiceEmailDeliveries(invoiceId: number): Promise<InvoiceEmailDelivery[]> {
    return db.select().from(invoiceEmailDeliveries)
      .where(eq(invoiceEmailDeliveries.invoiceId, invoiceId))
      .orderBy(desc(invoiceEmailDeliveries.createdAt))
      .limit(50);
  }

  // ── Layer 5C — Carrier Reconciliation ────────────────────────────────────────
  async createCarrierReconciliation(data: InsertCarrierReconciliation): Promise<CarrierReconciliation> {
    const [row] = await db.insert(carrierReconciliations).values(data).returning();
    return row;
  }

  async getCarrierReconciliation(id: number): Promise<CarrierReconciliation | null> {
    const [row] = await db.select().from(carrierReconciliations).where(eq(carrierReconciliations.id, id));
    return row ?? null;
  }

  async listCarrierReconciliations(opts: { status?: string; iTariff?: string; limit?: number } = {}): Promise<CarrierReconciliation[]> {
    const conditions = [];
    if (opts.status)  conditions.push(eq(carrierReconciliations.status,  opts.status));
    if (opts.iTariff) conditions.push(eq(carrierReconciliations.iTariff, opts.iTariff));
    const q = db.select().from(carrierReconciliations);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered.orderBy(desc(carrierReconciliations.createdAt)).limit(opts.limit ?? 100);
  }

  async updateCarrierReconciliation(id: number, updates: Partial<CarrierReconciliation>): Promise<CarrierReconciliation> {
    const [row] = await db.update(carrierReconciliations).set(updates).where(eq(carrierReconciliations.id, id)).returning();
    return row;
  }

  // ── Immutable Rating Snapshots (Layer 4C) ────────────────────────────────────
  async createInvoiceCdrSnapshot(data: InsertInvoiceCdrSnapshot): Promise<InvoiceCdrSnapshot> {
    const [row] = await db.insert(invoiceCdrSnapshots).values(data).returning();
    return row;
  }

  async getInvoiceCdrSnapshot(id: number): Promise<InvoiceCdrSnapshot | null> {
    const [row] = await db.select().from(invoiceCdrSnapshots).where(eq(invoiceCdrSnapshots.id, id));
    return row ?? null;
  }

  async getInvoiceCdrSnapshotByCdrId(cdrId: string): Promise<InvoiceCdrSnapshot | null> {
    const [row] = await db.select().from(invoiceCdrSnapshots)
      .where(eq(invoiceCdrSnapshots.cdrId, cdrId));
    return row ?? null;
  }

  async listInvoiceCdrSnapshots(opts: {
    iTariff?:            string;
    verificationStatus?: string;
    since?:              Date;
    limit?:              number;
  } = {}): Promise<InvoiceCdrSnapshot[]> {
    const conditions = [];
    if (opts.iTariff)            conditions.push(eq(invoiceCdrSnapshots.iTariff, opts.iTariff));
    if (opts.verificationStatus) conditions.push(eq(invoiceCdrSnapshots.verificationStatus, opts.verificationStatus));
    if (opts.since)              conditions.push(gte(invoiceCdrSnapshots.lockedAt, opts.since));

    const q = db.select().from(invoiceCdrSnapshots);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered
      .orderBy(desc(invoiceCdrSnapshots.lockedAt))
      .limit(opts.limit ?? 500);
  }

  async bulkCreateInvoiceCdrSnapshots(rows: InsertInvoiceCdrSnapshot[]): Promise<number> {
    if (rows.length === 0) return 0;
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await db.insert(invoiceCdrSnapshots)
        .values(rows.slice(i, i + CHUNK))
        .returning({ id: invoiceCdrSnapshots.id });
      inserted += result.length;
    }
    return inserted;
  }

  async getExistingCdrIdsForTariff(iTariff: string): Promise<Set<string>> {
    const rows = await db.select({ cdrId: invoiceCdrSnapshots.cdrId })
      .from(invoiceCdrSnapshots)
      .where(eq(invoiceCdrSnapshots.iTariff, iTariff));
    return new Set(
      rows.map(r => r.cdrId).filter((id): id is string => id !== null && id !== undefined)
    );
  }

  // ── Rating Verification (Layer 4B) ───────────────────────────────────────────
  async createRatingVerification(data: InsertRatingVerification): Promise<RatingVerification> {
    const [row] = await db.insert(ratingVerifications).values(data).returning();
    return row;
  }

  async getRatingVerification(id: number): Promise<RatingVerification | null> {
    const [row] = await db.select().from(ratingVerifications).where(eq(ratingVerifications.id, id));
    return row ?? null;
  }

  async listRatingVerifications(opts: {
    iTariff?: string;
    discrepancyType?: string;
    severity?: string;
    verificationStatus?: string;
    since?: Date;
    limit?: number;
  } = {}): Promise<RatingVerification[]> {
    const conditions = [];
    if (opts.iTariff)            conditions.push(eq(ratingVerifications.iTariff, opts.iTariff));
    if (opts.discrepancyType)    conditions.push(eq(ratingVerifications.discrepancyType, opts.discrepancyType));
    if (opts.severity)           conditions.push(eq(ratingVerifications.severity, opts.severity));
    if (opts.verificationStatus) conditions.push(eq(ratingVerifications.verificationStatus, opts.verificationStatus));
    if (opts.since)              conditions.push(gte(ratingVerifications.createdAt, opts.since));

    const q = db.select().from(ratingVerifications);
    const filtered = conditions.length > 0 ? q.where(and(...conditions)) : q;
    return filtered
      .orderBy(desc(ratingVerifications.createdAt))
      .limit(opts.limit ?? 500);
  }

  async updateRatingVerificationStatus(id: number, status: string, notes?: string): Promise<RatingVerification> {
    const updates: Partial<RatingVerification> = {
      verificationStatus: status,
      verifiedAt: new Date(),
    };
    if (notes) updates.notes = notes;
    const [row] = await db.update(ratingVerifications)
      .set(updates)
      .where(eq(ratingVerifications.id, id))
      .returning();
    return row;
  }

  // ── Tariff Versioning (Layer 4A) ─────────────────────────────────────────────
  async createTariffVersion(data: InsertTariffVersion): Promise<TariffVersion> {
    const [row] = await db.insert(tariffVersions).values(data).returning();
    return row;
  }

  async getTariffVersion(id: number): Promise<TariffVersion | null> {
    const [row] = await db.select().from(tariffVersions).where(eq(tariffVersions.id, id));
    return row ?? null;
  }

  async listTariffVersions(iTariff?: string): Promise<TariffVersion[]> {
    if (iTariff) {
      return db.select().from(tariffVersions)
        .where(eq(tariffVersions.iTariff, iTariff))
        .orderBy(desc(tariffVersions.createdAt));
    }
    return db.select().from(tariffVersions).orderBy(desc(tariffVersions.createdAt));
  }

  async getLatestTariffVersion(iTariff: string): Promise<TariffVersion | null> {
    const [row] = await db.select().from(tariffVersions)
      .where(eq(tariffVersions.iTariff, iTariff))
      .orderBy(desc(tariffVersions.createdAt))
      .limit(1);
    return row ?? null;
  }

  async listTariffChangeEvents(tariffVersionId: number): Promise<TariffChangeEvent[]> {
    return db.select().from(tariffChangeEvents)
      .where(eq(tariffChangeEvents.tariffVersionId, tariffVersionId))
      .orderBy(tariffChangeEvents.prefix);
  }

  async bulkCreateTariffChangeEvents(rows: InsertTariffChangeEvent[]): Promise<TariffChangeEvent[]> {
    if (!rows.length) return [];
    return db.insert(tariffChangeEvents).values(rows).returning();
  }

  // ── Portal Governance ──────────────────────────────────────────────────────

  async getPortalDefinitions(): Promise<PortalDefinition[]> {
    return db.select().from(portalDefinitions)
      .where(eq(portalDefinitions.isActive, true))
      .orderBy(asc(portalDefinitions.sortOrder));
  }

  async getPortalModules(portalSlug: string): Promise<PortalModuleWithMeta[]> {
    const rows = await db
      .select({
        id:           portalModuleAssignments.id,
        portalId:     portalModuleAssignments.portalId,
        moduleId:     portalModuleAssignments.moduleId,
        section:      portalModuleAssignments.section,
        displayOrder: portalModuleAssignments.displayOrder,
        displayLabel: portalModuleAssignments.displayLabel,
        adapter:      portalModuleAssignments.adapter,
        visibility:   portalModuleAssignments.visibility,
        isHome:       portalModuleAssignments.isHome,
        isPinned:     portalModuleAssignments.isPinned,
        updatedAt:    portalModuleAssignments.updatedAt,
        updatedBy:    portalModuleAssignments.updatedBy,
        moduleKey:    navigationModules.moduleKey,
        title:        navigationModules.title,
        icon:         navigationModules.icon,
        route:        navigationModules.route,
        engine:       navigationModules.engine,
        isSystem:     navigationModules.isSystem,
        isMovable:    navigationModules.isMovable,
      })
      .from(portalModuleAssignments)
      .innerJoin(navigationModules, eq(portalModuleAssignments.moduleId, navigationModules.id))
      .where(eq(portalModuleAssignments.portalId, portalSlug))
      .orderBy(asc(portalModuleAssignments.section), asc(portalModuleAssignments.displayOrder));
    return rows as PortalModuleWithMeta[];
  }

  async upsertPortalModuleAssignment(data: Partial<InsertPortalModuleAssignment> & { portalId: string; moduleId: number }): Promise<PortalModuleAssignment> {
    const [row] = await db
      .insert(portalModuleAssignments)
      .values({ ...data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [portalModuleAssignments.portalId, portalModuleAssignments.moduleId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row;
  }

  async removePortalModuleAssignment(portalId: string, moduleId: number): Promise<void> {
    await db.delete(portalModuleAssignments)
      .where(and(
        eq(portalModuleAssignments.portalId, portalId),
        eq(portalModuleAssignments.moduleId, moduleId),
      ));
  }

  async getPortalSections(portalSlug: string): Promise<PortalSection[]> {
    return db.select().from(portalSections)
      .where(and(
        eq(portalSections.portalId, portalSlug),
        eq(portalSections.isActive, true),
      ))
      .orderBy(asc(portalSections.sortOrder));
  }

  async resetPortalToDefaults(portalSlug: string): Promise<void> {
    await db.delete(portalModuleAssignments)
      .where(eq(portalModuleAssignments.portalId, portalSlug));
  }

  async getAllNavigationModules(): Promise<NavigationModule[]> {
    return db.select().from(navigationModules).orderBy(asc(navigationModules.sortOrder), asc(navigationModules.title));
  }

  async updatePortalDefinition(slug: string, data: { name?: string; icon?: string; theme?: string; isActive?: boolean; sortOrder?: number; defaultRoute?: string }): Promise<PortalDefinition> {
    const [row] = await db.update(portalDefinitions)
      .set(data)
      .where(eq(portalDefinitions.slug, slug))
      .returning();
    return row;
  }

  async createPortalSection(data: { portalId: string; sectionKey: string; title: string; icon?: string; sortOrder?: number }): Promise<PortalSection> {
    const [row] = await db.insert(portalSections).values({
      portalId:   data.portalId,
      sectionKey: data.sectionKey,
      title:      data.title,
      icon:       data.icon ?? 'circle',
      sortOrder:  data.sortOrder ?? 99,
      isActive:   true,
    }).returning();
    return row;
  }

  async updatePortalSection(id: number, data: { title?: string; icon?: string; sortOrder?: number; isActive?: boolean }): Promise<PortalSection> {
    const [row] = await db.update(portalSections)
      .set(data)
      .where(eq(portalSections.id, id))
      .returning();
    return row;
  }

  async deletePortalSection(id: number): Promise<void> {
    await db.delete(portalSections).where(eq(portalSections.id, id));
  }

  async reorderPortalSections(portalSlug: string, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, idx) =>
        db.update(portalSections)
          .set({ sortOrder: idx })
          .where(and(eq(portalSections.id, id), eq(portalSections.portalId, portalSlug)))
      )
    );
  }

  async updatePortalModuleAssignmentById(id: number, data: { section?: string; displayOrder?: number; displayLabel?: string; adapter?: string; visibility?: string; isPinned?: boolean }): Promise<PortalModuleAssignment> {
    const [row] = await db.update(portalModuleAssignments)
      .set(data)
      .where(eq(portalModuleAssignments.id, id))
      .returning();
    return row;
  }

  async reorderPortalModuleAssignments(portalId: string, sectionKey: string, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, idx) =>
        db.update(portalModuleAssignments)
          .set({ displayOrder: idx })
          .where(and(
            eq(portalModuleAssignments.id, id),
            eq(portalModuleAssignments.portalId, portalId),
            eq(portalModuleAssignments.section, sectionKey),
          ))
      )
    );
  }

  async getFavorites(userId: string): Promise<UserFavorite[]> {
    return db.select().from(userFavorites)
      .where(eq(userFavorites.userId, userId))
      .orderBy(asc(userFavorites.sortOrder), asc(userFavorites.createdAt));
  }

  async addFavorite(data: { userId: string; moduleKey: string; label?: string; icon?: string; route: string; portalKey?: string }): Promise<UserFavorite> {
    const existing = await db.select().from(userFavorites)
      .where(and(eq(userFavorites.userId, data.userId), eq(userFavorites.moduleKey, data.moduleKey)));
    if (existing.length > 0) return existing[0];
    const maxOrder = await db.select({ maxOrder: sql<number>`coalesce(max(sort_order),0)` })
      .from(userFavorites).where(eq(userFavorites.userId, data.userId));
    const [row] = await db.insert(userFavorites).values({
      userId:    data.userId,
      moduleKey: data.moduleKey,
      label:     data.label,
      icon:      data.icon ?? 'circle',
      route:     data.route,
      portalKey: data.portalKey,
      sortOrder: (maxOrder[0]?.maxOrder ?? 0) + 1,
    }).returning();
    return row;
  }

  async removeFavorite(userId: string, moduleKey: string): Promise<void> {
    await db.delete(userFavorites)
      .where(and(eq(userFavorites.userId, userId), eq(userFavorites.moduleKey, moduleKey)));
  }

  async reorderFavorites(userId: string, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, idx) =>
        db.update(userFavorites).set({ sortOrder: idx })
          .where(and(eq(userFavorites.id, id), eq(userFavorites.userId, userId)))
      )
    );
  }

  // ── Client Identity Map ────────────────────────────────────────────────────
  async listClientIdentities(opts: { activeOnly?: boolean; search?: string } = {}): Promise<ClientIdentity[]> {
    const rows = await db.select().from(clientIdentityMap).orderBy(asc(clientIdentityMap.billingName));
    let result = rows;
    if (opts.activeOnly) result = result.filter(r => r.active);
    if (opts.search) {
      const q = opts.search.toLowerCase();
      result = result.filter(r =>
        r.billingName?.toLowerCase().includes(q) ||
        r.displayName?.toLowerCase().includes(q) ||
        r.sippyUsername?.toLowerCase().includes(q) ||
        r.crmName?.toLowerCase().includes(q) ||
        String(r.iAccount ?? '').includes(q)
      );
    }
    return result;
  }

  async getClientIdentityByAccount(iAccount: number): Promise<ClientIdentity | null> {
    const [row] = await db.select().from(clientIdentityMap)
      .where(eq(clientIdentityMap.iAccount, iAccount));
    return row ?? null;
  }

  async getClientIdentityById(id: number): Promise<ClientIdentity | null> {
    const [row] = await db.select().from(clientIdentityMap)
      .where(eq(clientIdentityMap.id, id));
    return row ?? null;
  }

  async upsertClientIdentity(data: InsertClientIdentity): Promise<ClientIdentity> {
    if (data.iAccount != null) {
      const existing = await this.getClientIdentityByAccount(data.iAccount);
      if (existing) {
        return this.updateClientIdentity(existing.id, data);
      }
    }
    const [row] = await db.insert(clientIdentityMap)
      .values({ ...data, updatedAt: new Date() })
      .returning();
    return row;
  }

  async updateClientIdentity(id: number, updates: Partial<InsertClientIdentity>): Promise<ClientIdentity> {
    const [row] = await db.update(clientIdentityMap)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(clientIdentityMap.id, id))
      .returning();
    return row;
  }

  async deleteClientIdentity(id: number): Promise<void> {
    await db.delete(clientIdentityMap).where(eq(clientIdentityMap.id, id));
  }

  async resolveClientIdentity(
    iAccount: number | null | undefined,
    fallbackUsername?: string
  ): Promise<{ displayName: string; billingName: string; iAccount: number | null; sippyUsername: string | null; riskTier: string }> {
    if (iAccount != null) {
      const identity = await this.getClientIdentityByAccount(iAccount);
      if (identity) {
        return {
          displayName: identity.displayName ?? identity.billingName ?? identity.sippyUsername ?? `Account ${iAccount}`,
          billingName: identity.billingName ?? identity.displayName ?? identity.sippyUsername ?? `Account ${iAccount}`,
          iAccount,
          sippyUsername: identity.sippyUsername,
          riskTier: identity.riskTier ?? 'standard',
        };
      }
    }
    const username = fallbackUsername ?? (iAccount != null ? `Account ${iAccount}` : 'Unknown');
    return {
      displayName: username,
      billingName: username,
      iAccount: iAccount ?? null,
      sippyUsername: fallbackUsername ?? null,
      riskTier: 'standard',
    };
  }

  // ── Workspace Navigation Architecture ──────────────────────────────────────

  async getWorkspace(slug: string): Promise<WorkspaceWithTabs | null> {
    const [workspace] = await db.select().from(workspaceDefinitions)
      .where(eq(workspaceDefinitions.slug, slug));
    if (!workspace) return null;

    const tabs = await db.select().from(workspaceTabs)
      .where(eq(workspaceTabs.workspaceId, workspace.id))
      .orderBy(asc(workspaceTabs.sortOrder));

    const tabsWithItems: WorkspaceTabWithItems[] = await Promise.all(
      tabs.map(async tab => {
        const items = await db.select().from(workspaceTabItems)
          .where(eq(workspaceTabItems.tabId, tab.id))
          .orderBy(asc(workspaceTabItems.sortOrder));
        return { ...tab, items };
      })
    );

    return { ...workspace, tabs: tabsWithItems };
  }

  async getWorkspaceForRoute(route: string): Promise<WorkspaceWithTabs | null> {
    const [item] = await db.select().from(workspaceTabItems)
      .where(eq(workspaceTabItems.route, route));
    if (!item) return null;

    const [tab] = await db.select().from(workspaceTabs)
      .where(eq(workspaceTabs.id, item.tabId));
    if (!tab) return null;

    const [ws] = await db.select().from(workspaceDefinitions)
      .where(eq(workspaceDefinitions.id, tab.workspaceId));
    if (!ws) return null;

    return this.getWorkspace(ws.slug);
  }

  async listWorkspaces(): Promise<WorkspaceDefinition[]> {
    return db.select().from(workspaceDefinitions)
      .orderBy(asc(workspaceDefinitions.sortOrder));
  }

  async countWorkspaces(): Promise<number> {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceDefinitions);
    return count;
  }

  async upsertWorkspaceDefinition(data: Omit<WorkspaceDefinition, 'id' | 'createdAt'>): Promise<WorkspaceDefinition> {
    const [row] = await db.insert(workspaceDefinitions)
      .values(data)
      .onConflictDoUpdate({
        target: workspaceDefinitions.slug,
        set: { ...data },
      })
      .returning();
    return row;
  }

  async insertWorkspaceTab(data: Omit<WorkspaceTab, 'id'>): Promise<WorkspaceTab> {
    const [row] = await db.insert(workspaceTabs).values(data).returning();
    return row;
  }

  async insertWorkspaceTabItem(data: Omit<WorkspaceTabItem, 'id'>): Promise<WorkspaceTabItem> {
    const [row] = await db.insert(workspaceTabItems).values(data).returning();
    return row;
  }

  async updateWorkspaceTab(id: number, data: Partial<Pick<WorkspaceTab, 'label' | 'icon' | 'sortOrder' | 'isVisible' | 'visibilityRoles'>>): Promise<WorkspaceTab> {
    const [row] = await db.update(workspaceTabs)
      .set(data)
      .where(eq(workspaceTabs.id, id))
      .returning();
    return row;
  }

  async moveWorkspaceTabItem(itemId: number, newTabId: number, sortOrder?: number): Promise<WorkspaceTabItem> {
    const updateData: Record<string, any> = { tabId: newTabId };
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    const [row] = await db.update(workspaceTabItems)
      .set(updateData)
      .where(eq(workspaceTabItems.id, itemId))
      .returning();
    return row;
  }

  async reorderWorkspaceTabs(workspaceId: number, orderedIds: number[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        db.update(workspaceTabs)
          .set({ sortOrder: index })
          .where(and(eq(workspaceTabs.id, id), eq(workspaceTabs.workspaceId, workspaceId)))
      )
    );
  }

  // ── Payments ──────────────────────────────────────────────────────────────
  async createPayment(data: InsertPayment): Promise<Payment> {
    const [row] = await db.insert(payments).values(data).returning();
    return row;
  }
  async listPayments(opts: { companyId?: number; status?: string; limit?: number } = {}): Promise<Payment[]> {
    const conds: any[] = [];
    if (opts.companyId) conds.push(eq(payments.companyId, opts.companyId));
    if (opts.status)    conds.push(eq(payments.status, opts.status));
    const q = db.select().from(payments);
    const filtered = conds.length ? q.where(and(...conds)) : q;
    return filtered.orderBy(desc(payments.createdAt)).limit(opts.limit ?? 200);
  }
  async getPayment(id: number): Promise<Payment | null> {
    const [row] = await db.select().from(payments).where(eq(payments.id, id));
    return row ?? null;
  }
  async updatePayment(id: number, updates: Partial<Payment>): Promise<Payment> {
    const [row] = await db.update(payments).set(updates).where(eq(payments.id, id)).returning();
    return row;
  }
  async deletePayment(id: number): Promise<void> {
    await db.delete(payments).where(eq(payments.id, id));
  }

  // ── Invoice Schedules ──────────────────────────────────────────────────────
  async createInvoiceSchedule(data: InsertInvoiceSchedule): Promise<InvoiceSchedule> {
    const [row] = await db.insert(invoiceSchedules).values(data).returning();
    return row;
  }
  async listInvoiceSchedules(): Promise<InvoiceSchedule[]> {
    return db.select().from(invoiceSchedules).orderBy(desc(invoiceSchedules.createdAt));
  }
  async getInvoiceSchedule(id: number): Promise<InvoiceSchedule | null> {
    const [row] = await db.select().from(invoiceSchedules).where(eq(invoiceSchedules.id, id));
    return row ?? null;
  }
  async updateInvoiceSchedule(id: number, updates: Partial<InvoiceSchedule>): Promise<InvoiceSchedule> {
    const [row] = await db.update(invoiceSchedules).set(updates).where(eq(invoiceSchedules.id, id)).returning();
    return row;
  }
  async deleteInvoiceSchedule(id: number): Promise<void> {
    await db.delete(invoiceSchedules).where(eq(invoiceSchedules.id, id));
  }

  // ── Payment Reminder Config ────────────────────────────────────────────────
  async getPaymentReminderConfig(): Promise<PaymentReminderConfig | null> {
    const [row] = await db.select().from(paymentReminderConfig).limit(1);
    return row ?? null;
  }
  async upsertPaymentReminderConfig(data: Partial<PaymentReminderConfig>): Promise<PaymentReminderConfig> {
    const existing = await this.getPaymentReminderConfig();
    if (existing) {
      const [row] = await db.update(paymentReminderConfig)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(paymentReminderConfig.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db.insert(paymentReminderConfig).values({
      graceDays: 7, reminderIntervalDays: 7, maxReminders: 3, enabled: false,
      ...data, updatedAt: new Date(),
    }).returning();
    return row;
  }

  // ── CDR Re-rating ──────────────────────────────────────────────────────────
  async createCdrRerateRun(data: InsertCdrRerateRun): Promise<CdrRerateRun> {
    const [row] = await db.insert(cdrRerateRuns).values(data).returning();
    return row;
  }
  async listCdrRerateRuns(): Promise<CdrRerateRun[]> {
    return db.select().from(cdrRerateRuns).orderBy(desc(cdrRerateRuns.createdAt));
  }
  async getCdrRerateRun(id: number): Promise<CdrRerateRun | null> {
    const [row] = await db.select().from(cdrRerateRuns).where(eq(cdrRerateRuns.id, id));
    return row ?? null;
  }
  async updateCdrRerateRun(id: number, updates: Partial<CdrRerateRun>): Promise<CdrRerateRun> {
    const [row] = await db.update(cdrRerateRuns).set(updates).where(eq(cdrRerateRuns.id, id)).returning();
    return row;
  }
  async deleteCdrRerateRun(id: number): Promise<void> {
    await db.delete(cdrRerateRuns).where(eq(cdrRerateRuns.id, id));
  }

  // ── Reconciliation Email Audit Log ─────────────────────────────────────────
  async logReconciliationEmail(data: InsertReconciliationEmailLog): Promise<ReconciliationEmailLog> {
    const [row] = await db.insert(reconciliationEmailLog).values(data).returning();
    return row;
  }
  async listReconciliationEmailLogs(limit = 100): Promise<ReconciliationEmailLog[]> {
    return db.select().from(reconciliationEmailLog)
      .orderBy(desc(reconciliationEmailLog.sentAt))
      .limit(limit);
  }

  // ── Duplicate IP Sharing Approvals ───────────────────────────────────────────
  async getIpSharingApprovals(status?: string): Promise<IpSharingApproval[]> {
    const rows = await db.select().from(ipSharingApprovals).orderBy(desc(ipSharingApprovals.flaggedAt));
    return status ? rows.filter(r => r.status === status) : rows;
  }

  async getIpSharingApprovalByIp(ipAddress: string): Promise<IpSharingApproval | undefined> {
    if (!ipAddress) return undefined;
    const rows = await db.select().from(ipSharingApprovals).where(eq(ipSharingApprovals.ipAddress, ipAddress)).limit(1);
    return rows[0];
  }

  async upsertIpSharingApproval(ipAddress: string, companyData: string): Promise<IpSharingApproval> {
    const existing = await this.getIpSharingApprovalByIp(ipAddress);
    if (existing) {
      const [updated] = await db.update(ipSharingApprovals)
        .set({ companyData })
        .where(eq(ipSharingApprovals.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(ipSharingApprovals)
      .values({ ipAddress, companyData, status: 'pending' })
      .returning();
    return created;
  }

  async reviewIpSharingApproval(id: number, status: 'approved' | 'rejected', reviewedById: string, reviewedByName: string, reason?: string): Promise<IpSharingApproval> {
    const [updated] = await db.update(ipSharingApprovals)
      .set({ status, reviewedById, reviewedByName, reviewedAt: new Date(), reviewReason: reason ?? null })
      .where(eq(ipSharingApprovals.id, id))
      .returning();
    return updated;
  }
}

// ── Standalone helpers ─────────────────────────────────────────────────────────

/** Compute next trigger time for a reconciliation report schedule. */
function computeReconNextDueAt(frequency: string, dayOfMonth: number, dayOfWeek: number | undefined, cronHour: number): Date {
  const now = new Date();
  if (frequency === 'weekly') {
    const target = dayOfWeek ?? 1; // Monday default
    const current = now.getDay();
    let daysUntil = (target - current + 7) % 7;
    if (daysUntil === 0) daysUntil = 7; // next week if same day
    const next = new Date(now);
    next.setDate(next.getDate() + daysUntil);
    next.setHours(cronHour, 0, 0, 0);
    return next;
  }
  // monthly
  const day = Math.min(Math.max(dayOfMonth, 1), 28);
  const next = new Date(now);
  next.setDate(day);
  next.setHours(cronHour, 0, 0, 0);
  next.setMinutes(0, 0, 0);
  if (next <= now) {
    next.setMonth(next.getMonth() + 1);
  }
  return next;
}

function computeNextDueAt(frequency: string, cronHour?: number): Date {
  const now = new Date();
  switch (frequency) {
    case 'hourly': {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }
    case 'weekly': {
      const next = new Date(now);
      next.setDate(next.getDate() + 7);
      next.setHours(cronHour ?? 8, 0, 0, 0);
      return next;
    }
    default: { // daily
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(cronHour ?? 8, 0, 0, 0);
      return next;
    }
  }
}

export const storage = new DatabaseStorage();
