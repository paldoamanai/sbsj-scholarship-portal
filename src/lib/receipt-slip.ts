// Printable acknowledgment slip for a payment: an office copy and a student copy on one page.
// The receipt number on it is only visible to staff in the portal; the student types it back from
// their copy to confirm they received the money (see submit_student_receipt, migration 048).

export type ReceiptSlip = {
  receiptNo: string;
  studentName: string;
  studentId?: string | null;
  program: string;
  amount: number;
  method: string | null;
  reference?: string | null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function copy(s: ReceiptSlip, label: string, footer: string) {
  const date = new Date().toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });
  const row = (k: string, v: string) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`;
  return `
  <section class="slip">
    <header>
      <div><p class="org">San Jose Scholarship &amp; Financial Assistance</p><h1>Acknowledgment Receipt</h1></div>
      <div class="no"><span>Receipt No.</span><strong>${esc(s.receiptNo)}</strong><em>${label}</em></div>
    </header>
    <table>
      ${row("Date", date)}
      ${row("Received by", s.studentName)}
      ${s.studentId ? row("Student ID", s.studentId) : ""}
      ${row("Program", s.program)}
      ${row("Amount", peso(s.amount))}
      ${row("Method", s.method || "—")}
      ${s.reference ? row(s.method === "Cheque" ? "Cheque No." : "Reference", s.reference) : ""}
    </table>
    <p class="ack">I acknowledge that I received the amount stated above.</p>
    <div class="signs">
      <div><span></span>Signature of student over printed name</div>
      <div><span></span>Released by</div>
    </div>
    <p class="foot">${footer}</p>
  </section>`;
}

export function printReceiptSlip(s: ReceiptSlip) {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(s.receiptNo)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; }
  .slip { border: 1px solid #222; padding: 16px 20px; page-break-inside: avoid; }
  header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #222; padding-bottom: 8px; margin-bottom: 10px; }
  .org { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  h1 { margin: 2px 0 0; font-size: 18px; }
  .no { text-align: right; }
  .no span { display: block; font-size: 11px; }
  .no strong { display: block; font: 700 18px/1.2 ui-monospace, Menlo, monospace; letter-spacing: .05em; }
  .no em { font-size: 11px; font-style: normal; font-weight: 600; text-transform: uppercase; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-weight: 600; width: 32%; padding: 3px 0; }
  td { padding: 3px 0; }
  .ack { margin: 12px 0 28px; }
  .signs { display: flex; gap: 32px; }
  .signs div { flex: 1; font-size: 11px; text-align: center; }
  .signs span { display: block; border-top: 1px solid #222; margin-bottom: 2px; }
  .foot { margin: 14px 0 0; font-size: 11px; }
  .cut { border: 0; border-top: 1px dashed #888; margin: 18px 0; }
</style></head><body>
${copy(s, "Office copy", "Keep with the disbursement voucher, then upload a scan of this signed copy in the portal.")}
<hr class="cut">
${copy(s, "Student copy", `Keep this copy. To confirm you received this payment, sign in to the scholarship portal, open <strong>Payments</strong> and enter receipt number <strong>${esc(s.receiptNo)}</strong>.`)}
<script>window.onload = () => window.print();</script>
</body></html>`);
  win.document.close();
  return true;
}
