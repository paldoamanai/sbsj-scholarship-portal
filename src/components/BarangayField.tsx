"use client";

import { Input } from "@/components/ui/input";
import SearchableSelect from "@/components/SearchableSelect";
import { BARANGAYS, isHomeMunicipality } from "@/lib/barangays";

/**
 * Barangay input: a pick list for San Jose residents (so program barangay rules match exactly), free
 * text for anyone outside San Jose. A saved value that isn't on the list is kept as an option.
 */
export default function BarangayField({ value, onChange, municipality, className }: {
  value: string;
  onChange: (v: string) => void;
  municipality: string;
  className?: string;
}) {
  if (!isHomeMunicipality(municipality)) {
    return <Input className={className} autoComplete="address-level3" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  const legacy = value && !(BARANGAYS as readonly string[]).includes(value) ? value : null;
  return (
    <SearchableSelect className={className} value={value} onChange={onChange} placeholder="Select barangay" searchPlaceholder="Search barangay…"
      options={[
        ...(legacy ? [{ value: legacy, label: `${legacy} (not on the list, pick again)` }] : []),
        ...BARANGAYS.map((b) => ({ value: b, label: b })),
      ]} />
  );
}
