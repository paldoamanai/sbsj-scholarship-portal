// The student's "Download my data" export, as a readable PDF: their profile, then every record
// they own, one Field / Value table per record.

type Row = Record<string, unknown>;
export type MyDataSection = { title: string; itemLabel: string; rows: Row[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;
// Columns that only repeat who the export is for.
const HIDDEN = new Set(["user_id"]);

const label = (k: string) => k.replace(/_/g, " ").replace(/\b(id|url)\b/gi, (m) => m.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());

function value(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") {
    if (ISO_DATE.test(v)) {
      const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
      if (!isNaN(d.getTime())) return v.length === 10
        ? d.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" })
        : d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    // jsPDF's built-in fonts can't draw "₱".
    return v.replace(/₱/g, "PHP ");
  }
  if (typeof v === "object") return JSON.stringify(v, null, 1).replace(/₱/g, "PHP ");
  return String(v);
}

const fields = (r: Row) => Object.entries(r).filter(([k]) => !HIDDEN.has(k)).map(([k, v]) => [label(k), value(v)]);

export async function downloadMyDataPDF(email: string, profile: Row | null, sections: MyDataSection[]) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const left = 14;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("San Jose Scholarship Portal", left, 16);
  doc.setFontSize(12);
  doc.text("My Data", left, 23);
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`Account: ${email}`, left, 29);
  doc.text(`Exported ${new Date().toLocaleString("en-PH")}`, left, 34);
  let y = 44;

  const table = (rows: string[][]) => {
    autoTable(doc, {
      startY: y,
      body: rows,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 1.6, overflow: "linebreak" },
      columnStyles: { 0: { cellWidth: 48, fontStyle: "bold", fillColor: [245, 245, 245] } },
      margin: { left, right: left },
    });
    y = lastY() + 6;
  };
  const heading = (text: string, size: number) => {
    if (y > pageH - 30) { doc.addPage(); y = 16; }
    doc.setFont("helvetica", "bold").setFontSize(size);
    doc.text(text, left, y);
    y += size > 11 ? 4 : 3;
  };

  heading("Profile", 13);
  table(profile ? fields(profile) : [["Profile", "—"]]);

  for (const s of sections) {
    y += 2;
    heading(`${s.title} (${s.rows.length})`, 13);
    if (!s.rows.length) {
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
      doc.text("No records.", left, y + 3);
      doc.setTextColor(0);
      y += 10;
      continue;
    }
    s.rows.forEach((r, i) => {
      heading(`${s.itemLabel} ${i + 1}`, 10);
      table(fields(r));
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
    doc.text(`Page ${i} of ${pages}`, pageW - left, pageH - 8, { align: "right" });
  }
  doc.save(`my-data-${new Date().toISOString().slice(0, 10)}.pdf`);
}
