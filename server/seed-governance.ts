import { db } from "./db";
import { configurationValues, validationRules, governanceReviews } from "../shared/schema";
import { count } from "drizzle-orm";

const CONFIG_SEED = [
  { id:1,  category:"vendor",     configKey:"old_effective_date",            label:"Old Effective Date",                       description:null,                                                               unit:"days",   value:"7",           defaultValue:"7",           valueType:"days",   isEditable:true, isActive:true, sortOrder:10  },
  { id:2,  category:"vendor",     configKey:"future_effective_date",         label:"Future Effective Date",                    description:null,                                                               unit:"days",   value:"14",          defaultValue:"14",          valueType:"days",   isEditable:true, isActive:true, sortOrder:20  },
  { id:3,  category:"vendor",     configKey:"dial_code_changes_period",      label:"Dial Code Changes Period",                 description:null,                                                               unit:"days",   value:"0",           defaultValue:"0",           valueType:"days",   isEditable:true, isActive:true, sortOrder:30  },
  { id:4,  category:"vendor",     configKey:"increase_notice_period",        label:"Increase Notice Period",                   description:null,                                                               unit:"days",   value:"7",           defaultValue:"7",           valueType:"days",   isEditable:true, isActive:true, sortOrder:40  },
  { id:5,  category:"vendor",     configKey:"dial_code_length",              label:"Dial Code Length",                         description:null,                                                               unit:"number", value:"20",          defaultValue:"20",          valueType:"number", isEditable:true, isActive:true, sortOrder:50  },
  { id:6,  category:"vendor",     configKey:"rate_increase_alert",           label:"Rate Increase Alert",                      description:null,                                                               unit:"percent",value:"50.0",        defaultValue:"50.0",        valueType:"percent",isEditable:true, isActive:true, sortOrder:60  },
  { id:7,  category:"vendor",     configKey:"rate_decrease_alert",           label:"Rate Decrease Alert",                      description:null,                                                               unit:"percent",value:"50.0",        defaultValue:"50.0",        valueType:"percent",isEditable:true, isActive:true, sortOrder:70  },
  { id:8,  category:"vendor",     configKey:"rate_rounding_extent",          label:"Rate Rounding Extent",                     description:null,                                                               unit:"number", value:"4",           defaultValue:"4",           valueType:"number", isEditable:true, isActive:true, sortOrder:80  },
  { id:9,  category:"vendor",     configKey:"vendor_rate_response_email",    label:"Vendor Rate Response Email",               description:null,                                                               unit:"email",  value:"",            defaultValue:"",            valueType:"email",  isEditable:true, isActive:true, sortOrder:90  },
  { id:10, category:"vendor",     configKey:"accepted_file_size",            label:"Accepted File Size",                       description:null,                                                               unit:"mb",     value:"5",           defaultValue:"5",           valueType:"mb",     isEditable:true, isActive:true, sortOrder:100 },
  { id:11, category:"vendor",     configKey:"acceptable_shortest_duration",  label:"Acceptable Shortest Duration",             description:null,                                                               unit:"days",   value:"1",           defaultValue:"1",           valueType:"days",   isEditable:true, isActive:true, sortOrder:110 },
  { id:12, category:"vendor",     configKey:"acceptable_pending_increase",   label:"Acceptable Pending Increase",              description:null,                                                               unit:"number", value:"3",           defaultValue:"3",           valueType:"number", isEditable:true, isActive:true, sortOrder:120 },
  { id:13, category:"vendor",     configKey:"day_for_weekly_jobs",           label:"Day For Weekly Jobs",                      description:null,                                                               unit:null,     value:"Monday",      defaultValue:"Monday",      valueType:"text",   isEditable:true, isActive:true, sortOrder:130 },
  { id:14, category:"vendor",     configKey:"fortnightly_date_1",            label:"1st Date For Fortnightly Jobs",            description:null,                                                               unit:null,     value:"1",           defaultValue:"1",           valueType:"number", isEditable:true, isActive:true, sortOrder:140 },
  { id:15, category:"vendor",     configKey:"fortnightly_date_2",            label:"2nd Date For Fortnightly Jobs",            description:null,                                                               unit:null,     value:"15",          defaultValue:"15",          valueType:"number", isEditable:true, isActive:true, sortOrder:150 },
  { id:16, category:"vendor",     configKey:"date_for_monthly_jobs",         label:"Date For Monthly Jobs",                    description:null,                                                               unit:null,     value:"1",           defaultValue:"1",           valueType:"number", isEditable:true, isActive:true, sortOrder:160 },
  { id:17, category:"vendor",     configKey:"max_cdr_reconciliation_delay",  label:"Maximum Delay for CDR Reconciliation",     description:null,                                                               unit:"hour",   value:"2",           defaultValue:"2",           valueType:"hour",   isEditable:true, isActive:true, sortOrder:170 },
  { id:18, category:"vendor",     configKey:"default_domain",                label:"Default Domain",                           description:null,                                                               unit:"domain", value:"",            defaultValue:"",            valueType:"domain", isEditable:true, isActive:true, sortOrder:180 },
  { id:19, category:"global",     configKey:"system_date_format",            label:"System Date Format",                       description:null,                                                               unit:null,     value:"%d-%b-%Y",    defaultValue:"%d-%b-%Y",    valueType:"text",   isEditable:true, isActive:true, sortOrder:10  },
  { id:20, category:"global",     configKey:"system_time_format",            label:"System Time Format",                       description:null,                                                               unit:null,     value:"%H:%M:%S",    defaultValue:"%H:%M:%S",    valueType:"text",   isEditable:true, isActive:true, sortOrder:20  },
  { id:21, category:"global",     configKey:"system_datetime_format",        label:"System Date/Time Format",                  description:null,                                                               unit:null,     value:"%d-%b-%Y %H:%M:%S", defaultValue:"%d-%b-%Y %H:%M:%S", valueType:"text", isEditable:true, isActive:true, sortOrder:30 },
  { id:22, category:"global",     configKey:"file_limit",                    label:"File Limit",                               description:null,                                                               unit:null,     value:"5000",        defaultValue:"5000",        valueType:"number", isEditable:true, isActive:true, sortOrder:40  },
  { id:23, category:"global",     configKey:"user_limit",                    label:"User Limit",                               description:null,                                                               unit:null,     value:"50000",       defaultValue:"50000",       valueType:"number", isEditable:true, isActive:true, sortOrder:50  },
  { id:24, category:"global",     configKey:"min_invoice_duration_diff",     label:"Minimum Invoice Duration Difference",      description:null,                                                               unit:null,     value:"1",           defaultValue:"1",           valueType:"number", isEditable:true, isActive:true, sortOrder:60  },
  { id:25, category:"global",     configKey:"min_invoice_amount_diff",       label:"Minimum Invoice Amount Difference",        description:null,                                                               unit:null,     value:"0.1000",      defaultValue:"0.1000",      valueType:"float",  isEditable:true, isActive:true, sortOrder:70  },
  { id:26, category:"global",     configKey:"payment_notification_emails",   label:"Payment Notification Emails",              description:null,                                                               unit:null,     value:"",            defaultValue:"",            valueType:"email",  isEditable:true, isActive:true, sortOrder:80  },
  { id:27, category:"client",     configKey:"old_effective_date",            label:"Old Effective Date",                       description:null,                                                               unit:"days",   value:"7",           defaultValue:"7",           valueType:"days",   isEditable:true, isActive:true, sortOrder:10  },
  { id:28, category:"client",     configKey:"future_effective_date",         label:"Future Effective Date",                    description:null,                                                               unit:"days",   value:"15",          defaultValue:"15",          valueType:"days",   isEditable:true, isActive:true, sortOrder:20  },
  { id:29, category:"client",     configKey:"increase_notice_period",        label:"Increase Notice Period",                   description:null,                                                               unit:"days",   value:"7",           defaultValue:"7",           valueType:"days",   isEditable:true, isActive:true, sortOrder:30  },
  { id:30, category:"client",     configKey:"rate_increase_alert",           label:"Rate Increase Alert",                      description:null,                                                               unit:"percent",value:"50.0",        defaultValue:"50.0",        valueType:"percent",isEditable:true, isActive:true, sortOrder:40  },
  { id:31, category:"client",     configKey:"rate_decrease_alert",           label:"Rate Decrease Alert",                      description:null,                                                               unit:"percent",value:"50.0",        defaultValue:"50.0",        valueType:"percent",isEditable:true, isActive:true, sortOrder:50  },
  { id:32, category:"client",     configKey:"acceptable_pending_increase",   label:"Acceptable Pending Increase",              description:null,                                                               unit:"number", value:"10",          defaultValue:"10",          valueType:"number", isEditable:true, isActive:true, sortOrder:60  },
  { id:33, category:"client",     configKey:"client_rate_notification_email",label:"Client Rate Notification Email",           description:null,                                                               unit:"email",  value:"",            defaultValue:"",            valueType:"email",  isEditable:true, isActive:true, sortOrder:70  },
  { id:34, category:"client",     configKey:"standard_rate",                 label:"Standard Rate",                            description:null,                                                               unit:"float",  value:"5.0",         defaultValue:"5.0",         valueType:"float",  isEditable:true, isActive:true, sortOrder:80  },
  { id:35, category:"client",     configKey:"client_rate_rounding_extent",   label:"Client Rate Rounding Extent",              description:null,                                                               unit:"number", value:"5",           defaultValue:"5",           valueType:"number", isEditable:true, isActive:true, sortOrder:90  },
  { id:36, category:"client",     configKey:"rate_notifications_per_day",    label:"Rate Notifications Allowed Per Day",       description:null,                                                               unit:"number", value:"10",          defaultValue:"10",          valueType:"number", isEditable:true, isActive:true, sortOrder:100 },
  { id:37, category:"client",     configKey:"invoices_review_required",      label:"Client Invoices Review Required",          description:null,                                                               unit:"bool",   value:"true",        defaultValue:"true",        valueType:"bool",   isEditable:true, isActive:true, sortOrder:110 },
  { id:38, category:"client",     configKey:"auto_send_email_invoices",      label:"Automatically Send Email Invoices",        description:null,                                                               unit:"bool",   value:"false",       defaultValue:"false",       valueType:"bool",   isEditable:true, isActive:true, sortOrder:120 },
  { id:39, category:"client",     configKey:"send_invoice_to_kam",           label:"Send Invoice to KAM",                      description:null,                                                               unit:"bool",   value:"true",        defaultValue:"true",        valueType:"bool",   isEditable:true, isActive:true, sortOrder:130 },
  { id:40, category:"client",     configKey:"invoice_default_cc",            label:"Invoice Default CC Address",               description:null,                                                               unit:"email",  value:"",            defaultValue:"",            valueType:"email",  isEditable:true, isActive:true, sortOrder:140 },
  { id:41, category:"client",     configKey:"invoice_difference",            label:"Invoice Difference",                       description:null,                                                               unit:"number", value:"",            defaultValue:"",            valueType:"number", isEditable:true, isActive:true, sortOrder:150 },
  { id:42, category:"client",     configKey:"payment_report_duration",       label:"Payment Report Duration",                  description:null,                                                               unit:"number", value:"30",          defaultValue:"30",          valueType:"number", isEditable:true, isActive:true, sortOrder:160 },
  { id:43, category:"commercial", configKey:"require_approval_initial_rates",label:"Require Approval For Initial Rates",       description:"Approval required before sending first rate sheet to a new client",unit:null,     value:"false",       defaultValue:"true",        valueType:"bool",   isEditable:true, isActive:true, sortOrder:10  },
  { id:44, category:"commercial", configKey:"require_approval_rate_increase",label:"Require Approval For Rate Increase",       description:"Approval required when rates increase",                            unit:null,     value:"false",       defaultValue:"false",       valueType:"bool",   isEditable:true, isActive:true, sortOrder:20  },
  { id:45, category:"commercial", configKey:"require_approval_rate_decrease",label:"Require Approval For Rate Decrease",       description:"Approval required when rates decrease",                            unit:null,     value:"false",       defaultValue:"false",       valueType:"bool",   isEditable:true, isActive:true, sortOrder:30  },
  { id:46, category:"commercial", configKey:"require_approval_above_pct",    label:"Require Approval Above % Change",          description:"Trigger approval when rate change exceeds this threshold",         unit:"percent", value:"50",         defaultValue:"50",          valueType:"percent",isEditable:true, isActive:true, sortOrder:40  },
  { id:47, category:"commercial", configKey:"require_approval_above_dests",  label:"Require Approval Above Destinations",      description:"Trigger approval when push exceeds this destination count",        unit:"number",  value:"100",        defaultValue:"100",         valueType:"number", isEditable:true, isActive:true, sortOrder:50  },
  { id:48, category:"commercial", configKey:"require_approval_above_clients",label:"Require Approval Above Clients",           description:"Trigger approval when push affects more than this many clients",   unit:"number",  value:"25",         defaultValue:"25",          valueType:"number", isEditable:true, isActive:true, sortOrder:60  },
  { id:49, category:"commercial", configKey:"max_notifications_per_day",     label:"Max Notifications Per Day",                description:"Maximum rate notifications allowed per client per day",             unit:"number",  value:"10",         defaultValue:"10",          valueType:"number", isEditable:true, isActive:true, sortOrder:70  },
  { id:50, category:"commercial", configKey:"smtp_retry_count",              label:"SMTP Retry Count",                         description:"Number of retries for failed email sends",                         unit:"number",  value:"3",          defaultValue:"3",           valueType:"number", isEditable:true, isActive:true, sortOrder:80  },
  { id:51, category:"commercial", configKey:"email_batch_size",              label:"Email Batch Size",                         description:"Maximum recipients per email batch",                                unit:"number",  value:"50",         defaultValue:"50",          valueType:"number", isEditable:true, isActive:true, sortOrder:90  },
  { id:52, category:"commercial", configKey:"notification_retention_days",   label:"Notification Retention Days",              description:"How long to retain sent notification records",                      unit:"days",    value:"90",         defaultValue:"90",          valueType:"number", isEditable:true, isActive:true, sortOrder:100 },
  { id:53, category:"commercial", configKey:"default_notification_type",     label:"Default Notification Type",                description:"Default type used when creating a new template",                   unit:null,      value:"full_sheet",  defaultValue:"full_sheet",  valueType:"text",   isEditable:true, isActive:true, sortOrder:110 },
  { id:54, category:"commercial", configKey:"default_effective_date_offset", label:"Default Effective Date Offset",            description:"Default days ahead for rate effective date",                        unit:"days",    value:"7",          defaultValue:"7",           valueType:"days",   isEditable:true, isActive:true, sortOrder:120 },
  { id:55, category:"commercial", configKey:"max_future_effective_date",     label:"Maximum Future Effective Date",            description:"Maximum days ahead allowed for a rate effective date",              unit:"days",    value:"30",         defaultValue:"30",          valueType:"days",   isEditable:true, isActive:true, sortOrder:130 },
];

const RULES_SEED = [
  { id:1,  scope:"vendor",     groupName:"Rate Changes", ruleKey:"vendor_rate_increase_notice",  description:"Rate Increase Notice Violation",          configCategory:"vendor",     configKey:"increase_notice_period",          selectedAction:"ignore",       sortOrder:10 },
  { id:2,  scope:"vendor",     groupName:"Rate Changes", ruleKey:"vendor_suspect_rate_increase",  description:"Suspect Rate Increase",                   configCategory:"vendor",     configKey:"rate_increase_alert",             selectedAction:"ignore",       sortOrder:20 },
  { id:3,  scope:"vendor",     groupName:"Rate Changes", ruleKey:"vendor_suspect_rate_decrease",  description:"Suspect Rate Decrease",                   configCategory:"vendor",     configKey:"rate_decrease_alert",             selectedAction:"reject_country",sortOrder:30 },
  { id:4,  scope:"vendor",     groupName:"Suspicious",   ruleKey:"vendor_pending_increases",      description:"Pending Increases Exceeds Limit",         configCategory:"vendor",     configKey:"acceptable_pending_increase",     selectedAction:"ignore",       sortOrder:40 },
  { id:5,  scope:"vendor",     groupName:"Suspicious",   ruleKey:"vendor_eff_date_future",        description:"Effective Date Greater Than Allowed Limit",configCategory:"vendor",    configKey:"future_effective_date",           selectedAction:"reject_country",sortOrder:50 },
  { id:6,  scope:"vendor",     groupName:"Suspicious",   ruleKey:"vendor_eff_date_past",          description:"Effective Date Older Than Allowed Limit", configCategory:"vendor",     configKey:"old_effective_date",              selectedAction:"ignore",       sortOrder:60 },
  { id:7,  scope:"client",     groupName:"Rate Changes", ruleKey:"client_rate_increase_notice",   description:"Rate Increase Notice Violation",          configCategory:"client",     configKey:"increase_notice_period",          selectedAction:"ignore",       sortOrder:10 },
  { id:8,  scope:"client",     groupName:"Rate Changes", ruleKey:"client_suspect_rate_increase",  description:"Suspect Rate Increase",                   configCategory:"client",     configKey:"rate_increase_alert",             selectedAction:"ignore",       sortOrder:20 },
  { id:9,  scope:"client",     groupName:"Rate Changes", ruleKey:"client_suspect_rate_decrease",  description:"Suspect Rate Decrease",                   configCategory:"client",     configKey:"rate_decrease_alert",             selectedAction:"reject_country",sortOrder:30 },
  { id:10, scope:"client",     groupName:"Suspicious",   ruleKey:"client_pending_increases",      description:"Pending Increases Exceeds Limit",         configCategory:"client",     configKey:"acceptable_pending_increase",     selectedAction:"ignore",       sortOrder:40 },
  { id:11, scope:"client",     groupName:"Suspicious",   ruleKey:"client_eff_date_future",        description:"Effective Date Greater Than Allowed Limit",configCategory:"client",    configKey:"future_effective_date",           selectedAction:"reject_country",sortOrder:50 },
  { id:12, scope:"client",     groupName:"Suspicious",   ruleKey:"client_eff_date_past",          description:"Effective Date Older Than Allowed Limit", configCategory:"client",     configKey:"old_effective_date",              selectedAction:"ignore",       sortOrder:60 },
  { id:13, scope:"commercial", groupName:"Rate Changes", ruleKey:"comm_initial_rate_send",        description:"Initial Rate Sheet Sending",              configCategory:"commercial", configKey:"require_approval_initial_rates",  selectedAction:"approval_reqd",sortOrder:10 },
  { id:14, scope:"commercial", groupName:"Rate Changes", ruleKey:"comm_rate_increase",            description:"Rate Increase Above Threshold",           configCategory:"commercial", configKey:"require_approval_above_pct",      selectedAction:"approval_reqd",sortOrder:20 },
  { id:15, scope:"commercial", groupName:"Rate Changes", ruleKey:"comm_rate_decrease",            description:"Rate Decrease",                           configCategory:"commercial", configKey:"require_approval_rate_decrease",  selectedAction:"ignore",       sortOrder:30 },
  { id:16, scope:"commercial", groupName:"Suspicious",   ruleKey:"comm_eff_date_future",          description:"Effective Date Greater Than Allowed",     configCategory:"commercial", configKey:"max_future_effective_date",       selectedAction:"reject_country",sortOrder:40 },
  { id:17, scope:"commercial", groupName:"Suspicious",   ruleKey:"comm_excess_destinations",      description:"Push Exceeds Destination Limit",          configCategory:"commercial", configKey:"require_approval_above_dests",    selectedAction:"approval_reqd",sortOrder:50 },
  { id:18, scope:"commercial", groupName:"Suspicious",   ruleKey:"comm_excess_clients",           description:"Push Affects Excess Client Count",        configCategory:"commercial", configKey:"require_approval_above_clients",  selectedAction:"approval_reqd",sortOrder:60 },
];

export async function seedGovernanceData(): Promise<void> {
  try {
    const [{ value: cvCount }] = await db.select({ value: count() }).from(configurationValues);
    if (Number(cvCount) > 0) return;

    console.log("[seed] Seeding governance data (configuration_values + validation_rules + governance_reviews)…");

    await db.insert(configurationValues).values(
      CONFIG_SEED.map(r => ({
        category:     r.category,
        configKey:    r.configKey,
        label:        r.label,
        description:  r.description,
        unit:         r.unit,
        value:        r.value || null,
        defaultValue: r.defaultValue || null,
        valueType:    r.valueType,
        isEditable:   r.isEditable,
        isActive:     r.isActive,
        sortOrder:    r.sortOrder,
      }))
    ).onConflictDoNothing();

    await db.insert(validationRules).values(
      RULES_SEED.map(r => ({
        scope:          r.scope,
        groupName:      r.groupName,
        ruleKey:        r.ruleKey,
        description:    r.description,
        configCategory: r.configCategory,
        configKey:      r.configKey,
        selectedAction: r.selectedAction,
        sortOrder:      r.sortOrder,
        isActive:       true,
      }))
    ).onConflictDoNothing();

    const [{ value: grCount }] = await db.select({ value: count() }).from(governanceReviews);
    if (Number(grCount) === 0) {
      await db.insert(governanceReviews).values({ status: "draft" });
    }

    console.log("[seed] Governance data seeded successfully.");
  } catch (err) {
    console.error("[seed] Failed to seed governance data:", err);
  }
}
