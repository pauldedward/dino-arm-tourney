"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";

interface Filters {
  q: string;
  division: string;
  status: string;
}

export default function RegistrationsFilterBar({
  initial,
}: {
  initial: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [form, setForm] = useState<Filters>(initial);

  function apply(next: Filters) {
    const qs = new URLSearchParams(sp.toString());
    (Object.keys(next) as (keyof Filters)[]).forEach((k) => {
      if (next[k]) qs.set(k, next[k]);
      else qs.delete(k);
    });
    router.push(`${pathname}?${qs.toString()}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply(form);
      }}
      className="flex flex-wrap items-end gap-3 border-2 border-ink p-3"
    >
      <label className="block">
        <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Search</span>
        <input
          value={form.q}
          onChange={(e) => setForm({ ...form, q: e.target.value })}
          placeholder="Name / mobile / district"
          className="mt-1 block w-72 border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Division</span>
        <select
          value={form.division}
          onChange={(e) => {
            const next = { ...form, division: e.target.value };
            setForm(next);
            apply(next);
          }}
          className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
        >
          <option value="">All</option>
          <option>Men</option>
          <option>Women</option>
          <option>Para Men</option>
          <option>Para Women</option>
        </select>
      </label>
      <label className="block">
        <span className="font-mono text-[12px] uppercase tracking-[0.2em]">Status</span>
        <select
          value={form.status}
          onChange={(e) => {
            const next = { ...form, status: e.target.value };
            setForm(next);
            apply(next);
          }}
          className="mt-1 block border-2 border-ink bg-bone px-3 py-2 font-mono text-sm"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="weighed_in">Weighed in</option>
          <option value="withdrawn">Withdrawn</option>
          <option value="disqualified">Disqualified</option>
        </select>
      </label>
      <button
        type="submit"
        className="h-10 border-2 border-ink bg-ink px-4 font-mono text-[12px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust hover:border-rust"
      >
        Apply
      </button>
      {(form.q || form.division || form.status) && (
        <button
          type="button"
          onClick={() => {
            const clear = { q: "", division: "", status: "" };
            setForm(clear);
            apply(clear);
          }}
          className="h-10 border-2 border-ink/30 px-3 font-mono text-[12px] uppercase tracking-[0.2em] hover:border-ink"
        >
          Clear
        </button>
      )}
    </form>
  );
}
