"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Input>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max"> & {
  /** The plain amount, e.g. "1500000.5". Pass it (with onValueChange) to control the box. */
  value?: string | number | null;
  defaultValue?: string | number | null;
  onValueChange?: (raw: string) => void;
  min?: number;
  wrapperClassName?: string;
};

/** "1234567.5" → "1,234,567.5" while typing: commas in the whole pesos, decimals as typed (up to two). */
const group = (raw: string) => {
  const [whole, dec] = raw.split(".");
  const w = (whole.replace(/^0+(?=\d)/, "") || (dec !== undefined ? "0" : "")).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec === undefined ? w : `${w}.${dec}`;
};
/** What someone typed, reduced to digits and one decimal point with at most two decimals. */
const clean = (text: string) => {
  const s = text.replace(/[^\d.]/g, "");
  const i = s.indexOf(".");
  return i < 0 ? s : `${s.slice(0, i)}.${s.slice(i + 1).replace(/\./g, "").slice(0, 2)}`;
};
/** The finished look, once they leave the box: "1,234,567.50". */
const finish = (raw: string) => {
  const n = Number(raw);
  return raw === "" || !Number.isFinite(n) ? "" : n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const toRaw = (v: string | number | null | undefined) => (v == null ? "" : clean(String(v)));

/**
 * A peso amount box that shows ₱1,500,000.00 inside it. Commas appear while typing and two decimals
 * when they leave the box. With `name`, a hidden field submits the plain number ("1500000"), so forms
 * read it as before. Works controlled (value + onValueChange) or with defaultValue.
 */
export function MoneyInput({ value, defaultValue, onValueChange, min, name, required, wrapperClassName, className, onBlur, ...props }: Props) {
  const controlled = value !== undefined;
  const [raw, setRaw] = useState(() => toRaw(controlled ? value : defaultValue));
  const [text, setText] = useState(() => finish(raw));
  const ref = useRef<HTMLInputElement>(null);
  // Caret, counted in characters that aren't commas, to put back after commas move.
  const caret = useRef<number | null>(null);

  // The parent changed the amount (e.g. another application was opened): show the new one.
  useEffect(() => {
    if (!controlled) return;
    const next = toRaw(value);
    if (Number(next) !== Number(raw) || (next === "") !== (raw === "")) { setRaw(next); setText(finish(next)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const el = ref.current;
    if (caret.current === null || !el || document.activeElement !== el) return;
    let seen = 0, pos = 0;
    while (pos < text.length && seen < caret.current) { if (text[pos] !== ",") seen++; pos++; }
    el.setSelectionRange(pos, pos);
    caret.current = null;
  }, [text]);

  // Same checks a number box would make, so the form still refuses a bad amount.
  useEffect(() => {
    const n = Number(raw);
    ref.current?.setCustomValidity(raw !== "" && min !== undefined && n < min ? `Enter at least ₱${finish(String(min))}` : "");
  }, [raw, min]);

  const update = (next: string) => { setRaw(next); onValueChange?.(next); };

  return (
    <div className={cn("relative", wrapperClassName)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₱</span>
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        required={required}
        className={cn("pl-7 tabular-nums", className)}
        value={text}
        onChange={(e) => {
          const el = e.target;
          const before = el.value.slice(0, el.selectionStart ?? el.value.length);
          const next = clean(el.value);
          caret.current = clean(before).length;
          setText(group(next));
          update(next);
        }}
        onBlur={(e) => {
          setText(finish(raw));
          onBlur?.(e);
        }}
      />
      {name && <input type="hidden" name={name} value={raw} />}
    </div>
  );
}
