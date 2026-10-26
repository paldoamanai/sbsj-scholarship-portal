// Reads where a JPEG photo was taken from its EXIF GPS tags, if the phone kept them. Many phones and
// browsers remove the location when a photo is picked for upload, so a missing location is normal.

import type { LatLng } from "@/lib/geo";

export async function photoLocation(file: File): Promise<LatLng | null> {
  if (file.type !== "image/jpeg") return null;
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < view.byteLength) {
      const marker = view.getUint16(off);
      const size = view.getUint16(off + 2);
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) return readExif(view, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + size;
    }
  } catch { /* not readable */ }
  return null;
}

function readExif(view: DataView, tiff: number): LatLng | null {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const ifd0 = tiff + u32(tiff + 4);
  let gpsIfd = 0;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) gpsIfd = tiff + u32(e + 8);
  }
  if (!gpsIfd) return null;
  const tags: Record<number, number[] | string> = {};
  for (let i = 0, n = u16(gpsIfd); i < n; i++) {
    const e = gpsIfd + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    if (type === 2) tags[tag] = String.fromCharCode(view.getUint8(e + 8)); // N/S/E/W, inline
    if (type === 5 && count === 3) {
      const at = tiff + u32(e + 8);
      tags[tag] = [0, 1, 2].map((k) => u32(at + k * 8) / (u32(at + k * 8 + 4) || 1));
    }
  }
  const dms = (v: number[] | string | undefined) => (Array.isArray(v) ? v[0] + v[1] / 60 + v[2] / 3600 : NaN);
  let lat = dms(tags[2]), lng = dms(tags[4]);
  if (tags[1] === "S") lat = -lat;
  if (tags[3] === "W") lng = -lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}
