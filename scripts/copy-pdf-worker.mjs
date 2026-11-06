// Copies pdf.js's worker into public/ so the browser loads the same version the app bundles
// (src/lib/doc-checks/pdf.ts). Runs before `next dev` and `next build` (see package.json).

import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const from = path.join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const to = path.join(process.cwd(), "public", "pdf.worker.min.mjs");
await mkdir(path.dirname(to), { recursive: true });
await copyFile(from, to);
console.log("copy-pdf-worker: public/pdf.worker.min.mjs updated");
