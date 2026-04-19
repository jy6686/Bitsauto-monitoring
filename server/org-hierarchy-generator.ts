import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, Header, Footer, PageBreak, SimpleField,
} from 'docx';
import { writeFileSync } from 'fs';
import path from 'path';

export const ORG_HIERARCHY_PATH = path.join(process.cwd(), 'generated_docs', 'Org_Hierarchy_Access_Control.docx');

// ── Colour palette ──────────────────────────────────────────────────────────────
const DARK_BG  = '0D1117';
const ACCENT   = '00D4FF';
const GOLD     = 'FFD700';
const VIOLET   = 'A855F7';
const BLUE     = '3B82F6';
const GREEN    = '10B981';
const CYAN     = '06B6D4';
const ROSE     = 'F43F5E';
const WHITE    = 'FFFFFF';
const LIGHT_GY = 'E8E8E8';
const MID_GY   = 'BDBDBD';
const DARK_GY  = '424242';

// ── Helpers ─────────────────────────────────────────────────────────────────────
function h1(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 160 },
    children: [new TextRun({ text, color: ACCENT, bold: true, size: 44 })],
  });
}
function h2(text: string, color = WHITE) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 360, after: 120 },
    children: [new TextRun({ text, color, bold: true, size: 32 })],
  });
}
function h3(text: string, color = LIGHT_GY) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 280, after: 80 },
    children: [new TextRun({ text, color, bold: true, size: 26 })],
  });
}
function p(text: string, opts: { bold?: boolean; color?: string; size?: number; indent?: number; italic?: boolean } = {}) {
  return new Paragraph({
    indent: opts.indent ? { left: opts.indent } : undefined,
    spacing: { after: 100 },
    children: [new TextRun({ text, bold: opts.bold, color: opts.color ?? MID_GY, size: opts.size ?? 20, italics: opts.italic })],
  });
}
function bullet(text: string, color = MID_GY, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { after: 70 },
    children: [new TextRun({ text, color, size: 19 })],
  });
}
function check(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 70 },
    children: [
      new TextRun({ text: '✓  ', color: GREEN, bold: true, size: 20 }),
      new TextRun({ text, color: LIGHT_GY, size: 20 }),
    ],
  });
}
function cross(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 70 },
    children: [
      new TextRun({ text: '✗  ', color: ROSE, bold: true, size: 20 }),
      new TextRun({ text, color: MID_GY, size: 20 }),
    ],
  });
}
function divider() {
  return new Paragraph({
    border: { bottom: { color: DARK_GY, style: BorderStyle.SINGLE, size: 4 } },
    spacing: { before: 240, after: 240 },
    children: [],
  });
}
function spacer(after = 200) {
  return new Paragraph({ spacing: { after }, children: [] });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}
function roleHeader(emoji: string, roleLabel: string, personName: string, color: string) {
  return new Paragraph({
    spacing: { before: 320, after: 80 },
    children: [
      new TextRun({ text: `${emoji}  `, size: 32 }),
      new TextRun({ text: roleLabel, bold: true, color, size: 32 }),
      new TextRun({ text: `  —  ${personName}`, color: MID_GY, size: 24 }),
    ],
  });
}
function note(text: string) {
  return new Paragraph({
    indent: { left: 360 },
    spacing: { after: 100 },
    border: { left: { color: ACCENT, style: BorderStyle.SINGLE, size: 8 } },
    children: [new TextRun({ text: `ℹ  ${text}`, color: ACCENT, size: 18, italics: true })],
  });
}

// ── Access Rules Table ──────────────────────────────────────────────────────────
function accessTable() {
  const cols = ['Role', 'Person', 'Scope', 'Live Calls', 'BitsEye', 'Balances', 'Products', 'HOD Data', 'SVP Data', 'VP Data', 'Mgr Data', 'TL Data'];
  const YES = { text: '✓', color: GREEN };
  const NO  = { text: '✗', color: ROSE };
  const FULL = { text: 'Global', color: GOLD };
  const OWN  = { text: 'Own+Below', color: CYAN };

  const rows = [
    ['HOD',      'Junaid',        FULL,  YES, YES, YES, YES, YES, YES, YES, YES, YES],
    ['SVP',      'Sohaib Hameed', OWN,   YES, YES, YES, YES, NO,  YES, YES, YES, YES],
    ['VP',       'Iqra Khan',     OWN,   YES, YES, YES, YES, NO,  NO,  YES, YES, YES],
    ['Manager',  'Mahek Ali',     OWN,   YES, YES, YES, YES, NO,  NO,  NO,  YES, YES],
    ['TeamLead', 'Iqra Yousnus',  OWN,   YES, YES, YES, YES, NO,  NO,  NO,  NO,  YES],
    ['KAM',      'Rimsha Ali',    OWN,   YES, YES, YES, YES, NO,  NO,  NO,  NO,  NO],
  ];

  const headerRow = new TableRow({
    tableHeader: true,
    children: cols.map(c =>
      new TableCell({
        shading: { fill: '161B22', type: 'clear' },
        width: { size: c === 'Role' || c === 'Person' ? 12 : 7, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: c, bold: true, color: ACCENT, size: 17 })],
        })],
      })
    ),
  });

  const dataRows = rows.map(r => new TableRow({
    children: r.map((cell, i) => {
      const isObj = typeof cell === 'object' && cell !== null && 'text' in cell;
      const txt  = isObj ? (cell as any).text : String(cell);
      const clr  = isObj ? (cell as any).color : (i < 2 ? WHITE : MID_GY);
      return new TableCell({
        shading: { fill: i % 2 === 0 ? '0D1117' : '111827', type: 'clear' },
        width: { size: i <= 1 ? 12 : 7, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: txt, color: clr, size: 17, bold: i === 0 })],
        })],
      });
    }),
  }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });
}

// ── Main generator ──────────────────────────────────────────────────────────────
export async function generateOrgHierarchyDoc(outputPath: string) {
  const { mkdirSync, existsSync } = await import('fs');
  const dir = path.dirname(outputPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const doc = new Document({
    background: { color: DARK_BG },
    styles: {
      default: {
        document: { run: { color: MID_GY, size: 20, font: 'Calibri' } },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { color: ACCENT, style: BorderStyle.SINGLE, size: 6 } },
            spacing: { after: 80 },
            children: [
              new TextRun({ text: '🏢  VoIP Watcher — ', color: ACCENT, bold: true, size: 18 }),
              new TextRun({ text: 'Organisational Hierarchy & Access Control', color: MID_GY, size: 18 }),
              new TextRun({ text: `\t${today}`, color: DARK_GY, size: 16 }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: 'CONFIDENTIAL — Internal Use Only  |  Page ', color: DARK_GY, size: 16 }),
              new SimpleField('PAGE'),
              new TextRun({ text: ' of ', color: DARK_GY, size: 16 }),
              new SimpleField('NUMPAGES'),
            ],
          })],
        }),
      },
      children: [

        // ── Cover ───────────────────────────────────────────────────────────────
        spacer(600),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: '🏢', size: 120 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: 'Organisational Hierarchy', bold: true, color: ACCENT, size: 64 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 60 },
          children: [new TextRun({ text: '& Access Control Definition', bold: true, color: WHITE, size: 40 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: 'Telecom Monitoring System  |  VoIP Watcher Platform', color: MID_GY, size: 22 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          children: [new TextRun({ text: `Generated: ${today}`, color: DARK_GY, size: 18, italics: true })],
        }),
        spacer(400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'CONFIDENTIAL — Internal Use Only', color: ROSE, bold: true, size: 18 })],
        }),
        pageBreak(),

        // ── 1. Purpose ──────────────────────────────────────────────────────────
        h1('1.  Purpose & Scope'),
        p('This document defines the role-based visibility hierarchy implemented in the VoIP Watcher Telecom Monitoring System. It specifies which data each user level can access and how the system enforces access boundaries across all pages and analytical views.'),
        spacer(100),
        p('The organisational hierarchy ensures:', { bold: true, color: WHITE }),
        bullet('Strong multi-tenant data isolation — each user sees only their relevant scope'),
        bullet('Clear operational responsibility — every account has a defined owner at each tier'),
        bullet('Accurate performance tracking — KPIs are computed per role, not aggregated globally'),
        bullet('Prevention of unauthorized client visibility — no cross-scope data leakage'),
        bullet('Scalable telecom hierarchy management — adding new levels requires only schema updates'),
        spacer(100),
        note('This hierarchy is enforced server-side via the /api/org/my-scope endpoint and propagated to all data queries through the OrgScopeContext React context.'),
        divider(),

        // ── 2. Hierarchy Overview ───────────────────────────────────────────────
        h1('2.  Hierarchy Overview'),
        p('The system implements a 6-level reporting hierarchy. Each level can see its own data plus all data belonging to levels below it within its assigned scope.'),
        spacer(80),
        new Paragraph({
          spacing: { before: 160, after: 80 },
          children: [
            new TextRun({ text: '  HOD  ', bold: true, color: GOLD,   size: 22 }),
            new TextRun({ text: '→  ', color: DARK_GY, size: 22 }),
            new TextRun({ text: '  SVP  ', bold: true, color: VIOLET, size: 22 }),
            new TextRun({ text: '→  ', color: DARK_GY, size: 22 }),
            new TextRun({ text: '  VP  ', bold: true, color: BLUE,   size: 22 }),
            new TextRun({ text: '→  ', color: DARK_GY, size: 22 }),
            new TextRun({ text: '  Manager  ', bold: true, color: GREEN, size: 22 }),
            new TextRun({ text: '→  ', color: DARK_GY, size: 22 }),
            new TextRun({ text: '  Team Lead  ', bold: true, color: CYAN, size: 22 }),
            new TextRun({ text: '→  ', color: DARK_GY, size: 22 }),
            new TextRun({ text: '  KAM  ', bold: true, color: ROSE,   size: 22 }),
          ],
        }),
        spacer(80),
        p('Hierarchy rule: a user at level N can see data for all users at levels N, N-1, N-2, … 1 that report to them (directly or transitively). They cannot see data belonging to levels above N or to parallel branches not in their subtree.', { italic: true, color: MID_GY }),
        divider(),

        // ── 3. Defined Roles ─────────────────────────────────────────────────────
        h1('3.  Defined Roles & Access Rules'),
        spacer(80),

        // HOD
        roleHeader('👑', 'HOD — Head of Department', 'Junaid', GOLD),
        p('Full system visibility. The HOD is the single source of truth for all client and vendor data across the entire platform. No restrictions apply.', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('All clients — global view across every KAM and team'),
        check('Live call monitoring — all concurrent calls'),
        check('Traffic graphs — all clients, all vendors, all destinations'),
        check('BitsEye analytics — unrestricted drill-down'),
        check('Account balances — all vendor and client balances'),
        check('Product classification — all traffic types'),
        check('Team management — full CRUD on org hierarchy'),
        check('All system settings and configurations'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        bullet('Nothing is restricted for the HOD role.', DARK_GY),
        divider(),

        // SVP
        roleHeader('🏆', 'SVP — Senior Vice President', 'Sohaib Hameed', VIOLET),
        p('Restricted to SVP hierarchy only. The SVP can see data for all VPs, Managers, Team Leads, and KAMs that report up through them. Cannot see HOD-owned data or data from other SVP branches.', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('SVP-level assigned teams and all their clients'),
        check('All VP, Manager, Team Lead, and KAM data within their reporting subtree'),
        check('Live call monitoring (scoped to their client portfolio)'),
        check('Traffic graphs (scoped to their portfolio)'),
        check('BitsEye analytics (auto-filtered to their scope)'),
        check('Account balances (for their assigned clients)'),
        check('Product classification (for their portfolio)'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        cross('HOD-level client data or global client list'),
        cross('Data from other SVP branches (horizontal isolation)'),
        divider(),

        // VP
        roleHeader('💼', 'VP — Vice President', 'Iqra Khan', BLUE),
        p('Restricted to VP-level scope only. The VP can see data for all Managers, Team Leads, and KAMs reporting up through them. Cannot see HOD or SVP data outside their branch.', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('All clients assigned to Managers, Team Leads, and KAMs under them'),
        check('Live call monitoring for their client scope'),
        check('Traffic graphs for their scope'),
        check('BitsEye analytics (auto-filtered to their scope)'),
        check('Account balances for their scope'),
        check('Product classification for their scope'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        cross('HOD-level data'),
        cross('SVP-level data outside their reporting chain'),
        cross('Data from other VP branches (horizontal isolation)'),
        divider(),

        // Manager
        roleHeader('📋', 'Manager', 'Mahek Ali', GREEN),
        p('Manager-level restricted view. Sees data for all Team Leads and KAMs that directly or transitively report to them. Cannot access HOD, SVP, or VP data.', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('All clients assigned under their Team Leads and KAMs'),
        check('Live call monitoring for their managed client portfolio'),
        check('Traffic graphs for their scope'),
        check('BitsEye analytics (auto-filtered)'),
        check('Account balances for their scope'),
        check('Product classification for their scope'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        cross('HOD, SVP, or VP data'),
        cross('Data from other Manager branches'),
        divider(),

        // Team Lead
        roleHeader('👥', 'Team Lead', 'Iqra Yousnus', CYAN),
        p('Team-level visibility only. The Team Lead sees all clients assigned to KAMs that report to them. Cannot access any data from levels above (HOD, SVP, VP, Manager).', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('All clients assigned to KAMs under their team'),
        check('Live call monitoring for their team\'s client portfolio'),
        check('Traffic graphs for their team\'s scope'),
        check('BitsEye analytics (auto-filtered to their team scope)'),
        check('Account balances for their team\'s clients'),
        check('Product classification for their team'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        cross('HOD, SVP, VP, or Manager data'),
        cross('Other teams\' KAM data (horizontal isolation)'),
        divider(),

        // KAM
        roleHeader('🤝', 'KAM — Key Account Manager', 'Rimsha Ali', ROSE),
        p('Account-level access only. The KAM sees only the specific Sippy client accounts assigned to them. This is the most restricted role — a KAM cannot see any unassigned clients or data from any other level.', { color: LIGHT_GY }),
        spacer(60),
        p('Can access:', { bold: true, color: WHITE }),
        check('Only their directly assigned Sippy client accounts'),
        check('Live call monitoring for their assigned clients'),
        check('Traffic graphs scoped to their assigned clients'),
        check('BitsEye analytics — auto-filtered to their client list'),
        check('Account balances for their assigned clients'),
        check('Product classification for their clients'),
        spacer(60),
        p('Cannot access:', { bold: true, color: WHITE }),
        cross('Any unassigned clients'),
        cross('Higher-level hierarchy data (HOD / SVP / VP / Manager / Team Lead)'),
        cross('Data from other KAMs\' client portfolios'),
        pageBreak(),

        // ── 4. Access Matrix ─────────────────────────────────────────────────────
        h1('4.  Access Matrix'),
        p('The table below summarises data access for each role. ✓ = permitted, ✗ = denied, Global = unrestricted, Own+Below = own scope plus all subordinates.'),
        spacer(120),
        accessTable(),
        spacer(200),
        note('HOD data = clients/data owned directly at HOD level with no KAM assignment. SVP data = data in another SVP\'s branch. Horizontal isolation is enforced across all levels.'),
        divider(),

        // ── 5. System Logic ──────────────────────────────────────────────────────
        h1('5.  System Logic & Enforcement'),
        spacer(60),

        h2('5.1  Core Rule', ACCENT),
        p('Each user sees data ONLY for their own hierarchy level and below, within their assigned scope. Higher-level data and data from parallel (horizontal) branches is strictly restricted and not visible — even with admin tools.', { color: LIGHT_GY }),
        spacer(100),

        h2('5.2  How Scoping Works', WHITE),
        p('When a user logs into VoIP Watcher, the system:'),
        bullet('Checks if the authenticated user\'s ID matches a KAM record (kams.userId column)'),
        bullet('If matched, resolves their orgRole (HOD/SVP/VP/Manager/TeamLead/KAM) and their position in the tree (reportsTo chain)'),
        bullet('Computes their "subtree" — all KAM IDs that report to them, transitively via BFS tree walk'),
        bullet('Resolves all Sippy account IDs assigned to the entire subtree (their own + all subordinates)'),
        bullet('Returns this scope object via GET /api/org/my-scope: { kamId, orgRole, kamName, visibleAccountIds }'),
        bullet('The React OrgScopeContext distributes this scope to every page on the frontend'),
        bullet('Pages such as BitsEye automatically filter their data queries using the user\'s kamId'),
        bullet('HOD users or users with no KAM record receive null scope → full access'),
        spacer(100),

        h2('5.3  Scope Enforcement Points', WHITE),
        bullet('BitsEye (/bitseye): auto-passes ?kamId=N when orgScope.isScoped is true — all CDR data is pre-filtered server-side to accounts in the user\'s subtree'),
        bullet('Sidebar Navigation: scoped users see only "My Portfolio (RoleName)" link instead of the full KAM list'),
        bullet('API /api/bitseye/per-entity: server builds a kamFilterClientSet from subtree accounts, restricts CDR data before computing KPIs'),
        bullet('Future pages: import useOrgScope() and check orgScope.visibleAccountIds to apply the same restriction'),
        spacer(100),

        h2('5.4  Database Schema', WHITE),
        p('The hierarchy is stored in the kams table with three new columns:', { color: LIGHT_GY }),
        bullet('orgRole VARCHAR(20) — stores the role: HOD|SVP|VP|Manager|TeamLead|KAM  (default: KAM)'),
        bullet('reportsTo INTEGER — nullable foreign key referencing kams.id (parent node in the tree)'),
        bullet('userId VARCHAR(255) — nullable link to the auth users.id (activates scope on login)'),
        spacer(60),
        note('ORG_ROLE_RANK: { HOD: 6, SVP: 5, VP: 4, Manager: 3, TeamLead: 2, KAM: 1 } — used to validate that a person\'s reportsTo always points to a higher-rank node.'),
        divider(),

        // ── 6. Configuration Guide ───────────────────────────────────────────────
        h1('6.  Configuration Guide'),
        p('Follow these steps to configure the organisational hierarchy for each team member in VoIP Watcher.'),
        spacer(80),

        h2('Step 1 — Navigate to the Team Page', ACCENT),
        p('Go to Settings → Team (or click "Team" in the sidebar). Scroll past the Org Hierarchy tree panel to the "Key Account Managers (KAM)" section.'),
        spacer(80),

        h2('Step 2 — Add or Edit a KAM Record', ACCENT),
        p('Click "+ Add KAM" for a new person, or the edit pencil on an existing card. The KAM form dialog will open.'),
        spacer(80),

        h2('Step 3 — Set the Org Role', ACCENT),
        p('In the "Org Role" dropdown, select the appropriate level:'),
        bullet('HOD — Full system access (Junaid)'),
        bullet('SVP — Senior Vice President (Sohaib Hameed)'),
        bullet('VP — Vice President (Iqra Khan)'),
        bullet('Manager — Manager level (Mahek Ali)'),
        bullet('TeamLead — Team Lead (Iqra Yousnus)'),
        bullet('KAM — Account Manager (Rimsha Ali)'),
        spacer(80),

        h2('Step 4 — Set "Reports To"', ACCENT),
        p('In the "Reports To" dropdown, select the person this KAM reports to. The dropdown automatically filters to show only people with a higher Org Role rank. Leave empty for the HOD (top of tree).'),
        spacer(80),

        h2('Step 5 — Link Login Account', ACCENT),
        p('In the "Link Login Account" dropdown, select the platform user that this KAM record corresponds to. This connects the KAM\'s data scope to their actual login session. Once linked, when this user logs in, they will automatically see only data within their org scope.'),
        spacer(60),
        note('If no login account is linked, the KAM record exists in the hierarchy but no user session will be restricted to it. The person will have their default role-based access (admin/management/viewer).'),
        spacer(80),

        h2('Step 6 — Assign Client Accounts', ACCENT),
        p('In the "Assign Clients" picker, select the Sippy account(s) this person directly manages. For HOD/SVP/VP — this may be left empty since they see their subordinates\' clients automatically. For KAMs — assign all direct client accounts here.'),
        spacer(80),

        h2('Step 7 — Verify in the Org Hierarchy Tree', ACCENT),
        p('After saving, scroll up to the "Organisational Hierarchy" section on the Team page. You should see the person appear in the correct position in the tree, with their role badge colour and client count. Collapse/expand nodes using the chevron button.'),
        divider(),

        // ── 7. Current Configuration ──────────────────────────────────────────────
        h1('7.  Current Role Assignments'),
        spacer(60),
        p('The following personnel have been defined in the system as of the document generation date:', { color: LIGHT_GY }),
        spacer(80),

        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: ['Name', 'Role', 'Reports To', 'Scope'].map(t =>
                new TableCell({
                  shading: { fill: '161B22', type: 'clear' },
                  children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, color: ACCENT, size: 18 })] })],
                })
              ),
            }),
            ...[
              ['Junaid',        'HOD',      '—',              'Global — all clients & vendors'],
              ['Sohaib Hameed', 'SVP',      'Junaid (HOD)',   'All within SVP reporting subtree'],
              ['Iqra Khan',     'VP',       'SVP (hierarchy)','All within VP reporting subtree'],
              ['Mahek Ali',     'Manager',  'VP (hierarchy)', 'All within Manager reporting subtree'],
              ['Iqra Yousnus',  'TeamLead', 'Manager',        'All assigned KAM client portfolios'],
              ['Rimsha Ali',    'KAM',      'Team Lead',      'Only directly assigned Sippy accounts'],
            ].map(([name, role, reportsTo, scope]) =>
              new TableRow({
                children: [name, role, reportsTo, scope].map((v, i) =>
                  new TableCell({
                    shading: { fill: '0D1117', type: 'clear' },
                    children: [new Paragraph({
                      children: [new TextRun({
                        text: v,
                        color: i === 1 ? ACCENT : LIGHT_GY,
                        size: 18,
                        bold: i === 0,
                      })],
                    })],
                  })
                ),
              })
            ),
          ],
        }),
        spacer(200),
        note('Update this document after adding new team members or restructuring the hierarchy using the "Update Org Hierarchy Doc" button in Settings → Documentation Downloads.'),
        divider(),

        // ── 8. Security Notes ────────────────────────────────────────────────────
        h1('8.  Security & Compliance Notes'),
        spacer(60),
        bullet('All scope enforcement is server-side — the client UI is scoped as a UX aid but cannot bypass server restrictions.'),
        bullet('The /api/org/my-scope endpoint requires authentication (401 for unauthenticated requests).'),
        bullet('No cross-scope data leakage: the BFS subtree algorithm guarantees no ancestor or sibling branch data is included.'),
        bullet('The orgRole field does not replace the system-level role (admin/management/viewer) — both are enforced independently.'),
        bullet('HOD users assigned to the system admin role have both full org scope AND full system admin permissions.'),
        bullet('For audit purposes, all KAM record changes (PATCH /api/kam/:id) are recorded in server logs with the requesting userId.'),
        spacer(100),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 100 },
          children: [new TextRun({ text: '— End of Document —', color: DARK_GY, size: 18, italics: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: 'VoIP Watcher Telecom Monitoring Platform  |  CONFIDENTIAL', color: DARK_GY, size: 16 })],
        }),
      ],
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  writeFileSync(outputPath, buffer);
}
