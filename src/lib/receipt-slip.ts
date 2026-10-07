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

// Prints from a hidden iframe rather than a pop-up: pop-up blockers can't stop it, and print() only runs
// once the slip has loaded (the old window.onload in a document.write'd pop-up often fired too early).
export function printReceiptSlip(s: ReceiptSlip) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${esc(s.receiptNo)}</title>
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
${copy(s, "Student copy", `Keep this copy. To confirm you received this payment, sign in to the scholarship portal, open <strong>Payments</strong> and enter receipt number <strong>${esc(s.receiptNo)}</strong>. Once it is confirmed, you can download a soft copy of this slip there.`)}
</body></html>`;

  document.getElementById("receipt-slip-print")?.remove();
  const frame = document.createElement("iframe");
  frame.id = "receipt-slip-print";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return;
    // Browsers name the "Save as PDF" file after the top page's title.
    const title = document.title;
    document.title = `Receipt ${s.receiptNo}`;
    win.addEventListener("afterprint", () => { document.title = title; setTimeout(() => frame.remove(), 0); }, { once: true });
    win.focus();
    win.print();
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

// The student's soft copy, saved as a PDF. Only offered once their receipt number is confirmed
// (get_my_receipt_slip, migration 053), so it never gives the number away before the check.
export type StudentReceiptSlip = ReceiptSlip & { disbursedAt?: string | null; confirmedAt?: string | null };

// jsPDF's built-in fonts can't draw "₱", so the PDF spells the currency out.
const pdfPeso = (n: number) => `PHP ${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const longDate = (d: string) => new Date(d).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" });

export async function downloadReceiptSlipPDF(s: StudentReceiptSlip) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const left = 18, right = pageW - 18;
  let y = 22;

  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text("SAN JOSE SCHOLARSHIP & FINANCIAL ASSISTANCE", left, y);
  doc.text("Receipt No.", right, y, { align: "right" });
  y += 7;
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("Acknowledgment Receipt", left, y);
  doc.setFont("courier", "bold").setFontSize(15);
  doc.text(s.receiptNo, right, y, { align: "right" });
  y += 5;
  doc.setFont("helvetica", "bold").setFontSize(8);
  doc.text("STUDENT COPY (SOFT COPY)", right, y, { align: "right" });
  y += 3;
  doc.setLineWidth(0.4).line(left, y, right, y);
  y += 9;

  const rows: [string, string | null | undefined][] = [
    ["Date released", s.disbursedAt ? longDate(s.disbursedAt) : null],
    ["Received by", s.studentName],
    ["Student ID", s.studentId],
    ["Program", s.program],
    ["Amount", pdfPeso(s.amount)],
    ["Method", s.method || "—"],
    [s.method === "Cheque" ? "Cheque No." : "Reference", s.reference],
  ];
  doc.setFontSize(11);
  for (const [k, v] of rows) {
    if (!v) continue;
    doc.setFont("helvetica", "bold").text(k, left, y);
    doc.setFont("helvetica", "normal").text(doc.splitTextToSize(v, right - left - 50), left + 50, y);
    y += 7;
  }

  y += 4;
  doc.text("I acknowledge that I received the amount stated above.", left, y);
  y += 10;
  doc.setFont("helvetica", "bold").setTextColor(4, 120, 87);
  doc.text(`Confirmed in the scholarship portal${s.confirmedAt ? ` on ${longDate(s.confirmedAt)}` : ""}.`, left, y);
  doc.setTextColor(0);
  y += 12;
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90);
  doc.text(doc.splitTextToSize(
    `This is a soft copy downloaded from the scholarship portal on ${longDate(new Date().toISOString())}. ` +
    "The paper slip you signed when the money was released is the official record and is kept by the scholarship office. " +
    `To verify this receipt, contact the office and give receipt number ${s.receiptNo}.`,
    right - left,
  ), left, y);

  doc.save(`Acknowledgment-Receipt-${s.receiptNo}.pdf`);
}
