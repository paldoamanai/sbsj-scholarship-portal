"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className={className}><SelectValue placeholder="Select barangay" /></SelectTrigger>
      <SelectContent>
        {legacy && <SelectItem value={legacy}>{legacy} (not on the list, pick again)</SelectItem>}
        {BARANGAYS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
