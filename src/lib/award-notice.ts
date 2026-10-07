// Printable notice of scholarship award for an approved application, opened from the student dashboard.
// The student prints it or saves it as a PDF. The reference is the application id, so the office can look
// it up in Applicants to confirm it.

export type AwardNotice = {
  applicationId: string;
  studentName: string;
  studentId?: string | null;
  school?: string | null;
  courseYear?: string | null;
  program: string;
  amount: number | null;
  academicYear?: string | null;
  semester?: string | null;
  approvedAt: string | null;
  isRenewal: boolean;
  office: { email?: string; phone?: string; address?: string };
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (d: string | Date) => new Date(d).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

export function printAwardNotice(n: AwardNotice) {
  const win = window.open("", "_blank");
  if (!win) return false;
  const ref = n.applicationId.slice(0, 8).toUpperCase();
  const row = (k: string, v: string | null | undefined) => (v ? `<tr><th>${k}</th><td>${esc(v)}</td></tr>` : "");
  const term = [n.academicYear, n.semester].filter(Boolean).join(" · ");
  const office = [n.office.address, n.office.email, n.office.phone].filter(Boolean).map((x) => esc(x!)).join(" · ");

  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Award Notice ${esc(ref)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #222; padding-bottom: 10px; margin-bottom: 22px; }
  .org { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  h1 { margin: 4px 0 0; font-size: 22px; }
  .ref { text-align: right; font-size: 12px; }
  .ref strong { display: block; font: 700 16px/1.3 ui-monospace, Menlo, monospace; letter-spacing: .05em; }
  p { margin: 0 0 14px; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0 22px; }
  th { text-align: left; font-weight: 600; width: 34%; padding: 6px 0; border-bottom: 1px solid #ddd; vertical-align: top; }
  td { padding: 6px 0; border-bottom: 1px solid #ddd; }
  .amount { font-size: 18px; font-weight: 700; }
  .foot { margin-top: 36px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 11px; color: #444; }
  .actions { margin: 0 0 20px; }
  .actions button { font: inherit; padding: 6px 14px; cursor: pointer; }
  @media print { .actions { display: none; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">Print or save as PDF</button></div>
<header>
  <div><p class="org">San Jose Scholarship &amp; Financial Assistance</p><h1>Notice of Scholarship Award</h1></div>
  <div class="ref">Reference<strong>${esc(ref)}</strong>Issued ${esc(longDate(new Date()))}</div>
</header>
<p>This is to certify that <strong>${esc(n.studentName)}</strong> has been approved for the scholarship program below${n.isRenewal ? " as a renewing scholar" : ""}.</p>
<table>
  ${row("Scholar", n.studentName)}
  ${row("Student ID", n.studentId)}
  ${row("School", n.school)}
  ${row("Course · Year", n.courseYear)}
  ${row("Program", n.program)}
  ${row("Academic term", term)}
  ${n.amount != null && n.amount > 0 ? `<tr><th>Award amount</th><td class="amount">${peso(n.amount)}</td></tr>` : ""}
  ${row("Date approved", n.approvedAt ? longDate(n.approvedAt) : null)}
</table>
<p>The award is released according to the program's disbursement schedule and remains subject to the program's conditions.</p>
<p class="foot">Generated from the scholarship portal. To verify this notice, contact the scholarship office and give reference ${esc(ref)}.${office ? `<br>${office}` : ""}</p>
</body></html>`);
  win.document.close();
  return true;
}
