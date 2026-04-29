"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ageOnMatchDay,
  eligibleNonParaClasses,
  eligibleParaCategories,
  type Hand,
} from "@/lib/rules/registration-rules";
import CameraCapture from "./CameraCapture";
import WeightOverridePicker from "./WeightOverridePicker";
import type { WeightOverride } from "@/lib/rules/resolve";

/**
 * AthleteEditModal — typo-fix surface for the registrations table.
 *
 * Loads the registration via GET /api/admin/registrations/[id] (the same
 * payload the counter desk uses to hydrate its edit flow) and PATCHes a
 * strict allow-list of fields back. Aadhaar, photo, payment, lifecycle
 * and chest_no are all out of scope on purpose — those have their own
 * dedicated screens and audit trails.
 *
 * Mode of work: fix mistakes, not re-do registration. Operator opens
 * from the FRT row's pencil icon, edits one or two fields, hits save.
 */

interface Props {
  registrationId: string;
  onClose: () => void;
  /** Fired after a successful save. Caller refreshes the row. */
  onSaved: () => void;
}

interface Payload {
  full_name: string;
  initial: string;
  dob: string;
  gender: "M" | "F";
  affiliation_kind: "District" | "Team";
  district: string;
  team: string;
  mobile: string;
  declared_weight_kg: number;
  weight_overrides: WeightOverride[];
  channel: "online" | "offline";
  nonpara_classes: string[];
  nonpara_hands: Record<string, Hand>;
  para_codes: string[];
  para_hand: Hand | null;
  // Athlete photo — storage key persisted on registrations.photo_url.
  // `null` clears it. Tracked alongside the rest of the draft so dirty-
  // detection picks up a photo replace just like any other edit.
  photo_key: string | null;
}

export default function AthleteEditModal({
  registrationId,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventStartsAt, setEventStartsAt] = useState<string | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [original, setOriginal] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Payload | null>(null);
  // Photo state lives outside `draft` because the preview URL is local
  // (signed URL or blob: URL of the just-captured shot) and must never
  // leak into the PATCH body. Only `draft.photo_key` is sent.
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Hydrate from the GET endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/registrations/${registrationId}`, {
          cache: "no-store",
        });
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(j.error ?? "load failed");
          setLoading(false);
          return;
        }
        const p = j.payload as Record<string, unknown>;
        setEventStartsAt((p.event_starts_at as string | null) ?? null);
        setEventId((p.event_id as string | null) ?? null);
        const loaded: Payload = {
          full_name: (p.full_name as string) ?? "",
          initial: (p.initial as string) ?? "",
          dob: (p.dob as string) ?? "",
          gender: (p.gender as "M" | "F") ?? "M",
          affiliation_kind:
            ((p.affiliation_kind as "District" | "Team") ?? "District"),
          district: (p.district as string) ?? "",
          team: (p.team as string) ?? "",
          mobile: (p.mobile as string) ?? "",
          declared_weight_kg: Number(p.declared_weight_kg) || 0,
          weight_overrides: Array.isArray(p.weight_overrides)
            ? (p.weight_overrides as WeightOverride[])
            : [],
          channel: ((p.channel as "online" | "offline") ?? "offline"),
          nonpara_classes: (p.nonpara_classes as string[] | null) ?? [],
          nonpara_hands:
            (p.nonpara_hands as Record<string, Hand> | null) ?? {},
          para_codes: (p.para_codes as string[] | null) ?? [],
          para_hand: (p.para_hand as Hand | null) ?? null,
          photo_key: (p.photo_key as string | null) ?? null,
        };
        setOriginal(loaded);
        setDraft(loaded);
        setPhotoPreviewUrl((p.photo_signed_url as string | null) ?? null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const age = useMemo(() => {
    if (!draft?.dob || !eventStartsAt) return null;
    return ageOnMatchDay(draft.dob, eventStartsAt);
  }, [draft?.dob, eventStartsAt]);
  const nonparaEligible = useMemo(
    () => (draft && age != null ? eligibleNonParaClasses(draft.gender, age) : []),
    [draft, age],
  );
  const paraEligible = useMemo(
    () => (draft && age != null ? eligibleParaCategories(draft.gender, age) : []),
    [draft, age],
  );

  const dirty = useMemo(() => {
    if (!draft || !original) return false;
    return JSON.stringify(draft) !== JSON.stringify(original);
  }, [draft, original]);

  const patch = useCallback(<K extends keyof Payload>(k: K, v: Payload[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  }, []);

  const toggleClass = useCallback(
    (code: string) => {
      setDraft((d) => {
        if (!d) return d;
        const has = d.nonpara_classes.includes(code);
        const nextClasses = has
          ? d.nonpara_classes.filter((c) => c !== code)
          : [...d.nonpara_classes, code];
        const nextHands = { ...d.nonpara_hands };
        if (has) delete nextHands[code];
        else if (!nextHands[code]) nextHands[code] = "R";
        return { ...d, nonpara_classes: nextClasses, nonpara_hands: nextHands };
      });
    },
    [],
  );

  const toggleParaCode = useCallback((code: string) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.para_codes.includes(code);
      // Single-para-code model: selecting one replaces, deselecting clears.
      return {
        ...d,
        para_codes: has ? [] : [code],
        para_hand: has ? null : d.para_hand ?? "R",
      };
    });
  }, []);

  // Capture → upload → stash the storage key on the draft. The PATCH on
  // save will set registrations.photo_url to this key. We surface a
  // local blob: preview immediately so the operator sees the new shot
  // without waiting for the upload round-trip.
  const onPhotoCaptured = useCallback(
    async (blob: Blob) => {
      setCameraOpen(false);
      if (!eventId) {
        setError("event id missing — reload the page");
        return;
      }
      const localUrl = URL.createObjectURL(blob);
      setPhotoPreviewUrl((prev) => {
        // Revoke prior blob: previews to avoid leaking ObjectURLs.
        if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return localUrl;
      });
      setPhotoUploading(true);
      try {
        const form = new FormData();
        form.append(
          "file",
          new File([blob], `photo-${Date.now()}.jpg`, {
            type: blob.type || "image/jpeg",
          }),
        );
        form.append("purpose", "reg-photo");
        form.append("event_id", eventId);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "upload failed");
        setDraft((d) => (d ? { ...d, photo_key: data.key as string } : d));
      } catch (e) {
        setError(`photo upload: ${(e as Error).message}`);
      } finally {
        setPhotoUploading(false);
      }
    },
    [eventId],
  );

  const save = useCallback(async () => {
    if (!draft || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/registrations/${registrationId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          full_name: draft.full_name,
          initial: draft.initial || null,
          dob: draft.dob,
          gender: draft.gender,
          mobile: draft.mobile,
          affiliation_kind: draft.affiliation_kind,
          district: draft.district || null,
          team: draft.team || null,
          declared_weight_kg: draft.declared_weight_kg,
          weight_overrides: draft.weight_overrides,
          channel: draft.channel,
          nonpara_classes: draft.nonpara_classes,
          nonpara_hands: draft.nonpara_hands,
          para_codes: draft.para_codes,
          para_hand: draft.para_hand,
          photo_key: draft.photo_key,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }, [draft, dirty, registrationId, onSaved, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[min(720px,95vw)] flex-col border-2 border-ink bg-bone shadow-[8px_8px_0_0_rgba(10,27,20,0.9)]"
      >
        <header className="flex items-center justify-between border-b-2 border-ink bg-kraft/20 px-4 py-3">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.3em] text-ink/50">
              Edit registration
            </p>
            <h2 className="mt-1 font-display text-2xl font-black tracking-tight">
              {draft?.full_name || "Loading…"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-ink px-3 py-1 font-mono text-[12px] uppercase tracking-[0.2em] hover:bg-rust hover:text-white"
            aria-label="Close"
          >
            Esc ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <p className="font-mono text-[13px] text-ink/50">Loading…</p>
          )}
          {error && (
            <p className="mb-3 border-2 border-rust bg-rust/10 px-3 py-2 font-mono text-[13px] text-rust">
              {error}
            </p>
          )}
          {draft && !loading && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full name">
                <input
                  type="text"
                  value={draft.full_name}
                  onChange={(e) => patch("full_name", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Initial">
                <input
                  type="text"
                  value={draft.initial}
                  onChange={(e) => patch("initial", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="DOB (YYYY-MM-DD)">
                <input
                  type="date"
                  value={draft.dob}
                  onChange={(e) => patch("dob", e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={`Sex${age != null ? ` · age ${age}` : ""}`}>
                <div className="flex gap-1">
                  {(["M", "F"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => patch("gender", g)}
                      className={`flex-1 border-2 px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                        draft.gender === g
                          ? "border-ink bg-ink text-bone"
                          : "border-ink/40 hover:border-ink"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Mobile">
                <input
                  type="tel"
                  value={draft.mobile}
                  onChange={(e) => patch("mobile", e.target.value.replace(/\D/g, ""))}
                  className={inputCls}
                />
              </Field>
              <Field label="Channel">
                <div className="flex gap-1">
                  {(["offline", "online"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => patch("channel", c)}
                      className={`flex-1 border-2 px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                        draft.channel === c
                          ? "border-ink bg-ink text-bone"
                          : "border-ink/40 hover:border-ink"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Affiliation">
                <div className="flex gap-1">
                  {(["District", "Team"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => patch("affiliation_kind", k)}
                      className={`flex-1 border-2 px-3 py-2 font-mono text-[13px] uppercase tracking-[0.2em] ${
                        draft.affiliation_kind === k
                          ? "border-ink bg-ink text-bone"
                          : "border-ink/40 hover:border-ink"
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Declared weight (kg)">
                <input
                  type="number"
                  step="0.1"
                  value={draft.declared_weight_kg || ""}
                  onChange={(e) =>
                    patch("declared_weight_kg", Number(e.target.value) || 0)
                  }
                  className={inputCls}
                />
              </Field>
              <Field label={draft.affiliation_kind === "District" ? "District" : "Team"}>
                {draft.affiliation_kind === "District" ? (
                  <input
                    type="text"
                    value={draft.district}
                    onChange={(e) => patch("district", e.target.value)}
                    className={inputCls}
                  />
                ) : (
                  <input
                    type="text"
                    value={draft.team}
                    onChange={(e) => patch("team", e.target.value)}
                    className={inputCls}
                  />
                )}
              </Field>
              <Field label="Weight class">
                <div className="border-2 border-ink/40 p-2">
                  <WeightOverridePicker
                    reg={{
                      gender: draft.gender,
                      nonpara_classes: draft.nonpara_classes,
                      nonpara_hands: draft.nonpara_classes.map(
                        (c) => draft.nonpara_hands[c] ?? null
                      ),
                      para_codes: draft.para_codes,
                      para_hand: draft.para_hand,
                      weight_overrides: draft.weight_overrides,
                    }}
                    weightKg={draft.declared_weight_kg}
                    value={draft.weight_overrides}
                    onChange={(v) => patch("weight_overrides", v)}
                    compact
                  />
                </div>
              </Field>

              <div className="col-span-2">
                <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
                  Athlete photo
                </p>
                <div className="mt-1 flex items-center gap-3 border-2 border-ink/40 p-2">
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center border border-ink/30 bg-kraft/20">
                    {photoPreviewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoPreviewUrl}
                        alt="athlete photo"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink/40">
                        none
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => setCameraOpen(true)}
                      disabled={photoUploading || !eventId}
                      className="border-2 border-ink px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.2em] hover:bg-ink hover:text-bone disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {photoUploading
                        ? "Uploading…"
                        : photoPreviewUrl
                        ? "Replace photo"
                        : "Take photo"}
                    </button>
                    <p className="font-mono text-[11px] text-ink/50">
                      New shot replaces the existing photo on save. Saved
                      via the same allow-listed PATCH; no Aadhaar / payment
                      side-effects.
                    </p>
                  </div>
                </div>
              </div>

              <div className="col-span-2">
                <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
                  Non-para classes
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {nonparaEligible.length === 0 ? (
                    <span className="font-mono text-[12px] text-ink/40">
                      Set DOB + sex to load eligible classes.
                    </span>
                  ) : (
                    nonparaEligible.map((entry) => {
                      const c = entry.className;
                      const on = draft.nonpara_classes.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleClass(c)}
                          className={`h-8 border-2 px-2 font-mono text-[12px] font-bold uppercase tracking-[0.15em] ${
                            on
                              ? "border-ink bg-ink text-bone"
                              : "border-ink/40 hover:border-ink"
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })
                  )}
                </div>
                {draft.nonpara_classes.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {draft.nonpara_classes.map((c) => (
                      <Field key={c} label={`${c} hand`}>
                        <div className="flex gap-1">
                          {((["R", "L", "B"]) as Hand[]).map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() =>
                                patch("nonpara_hands", {
                                  ...draft.nonpara_hands,
                                  [c]: h,
                                })
                              }
                              className={`flex-1 border-2 px-2 py-1 font-mono text-[12px] uppercase tracking-[0.15em] ${
                                draft.nonpara_hands[c] === h
                                  ? "border-ink bg-ink text-bone"
                                  : "border-ink/40 hover:border-ink"
                              }`}
                            >
                              {h}
                            </button>
                          ))}
                        </div>
                      </Field>
                    ))}
                  </div>
                )}
              </div>

              {paraEligible.length > 0 && (
                <div className="col-span-2">
                  <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
                    Para code
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {paraEligible.map((entry) => {
                      const c = entry.code;
                      const on = draft.para_codes.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleParaCode(c)}
                          className={`h-8 border-2 px-2 font-mono text-[12px] font-bold uppercase tracking-[0.15em] ${
                            on
                              ? "border-ink bg-ink text-bone"
                              : "border-ink/40 hover:border-ink"
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  {draft.para_codes.length > 0 && (
                    <div className="mt-2 max-w-[12rem]">
                      <Field label="Para hand">
                        <div className="flex gap-1">
                          {((["R", "L", "B"]) as Hand[]).map((h) => (
                            <button
                              key={h}
                              type="button"
                              onClick={() => patch("para_hand", h)}
                              className={`flex-1 border-2 px-2 py-1 font-mono text-[12px] uppercase tracking-[0.15em] ${
                                draft.para_hand === h
                                  ? "border-ink bg-ink text-bone"
                                  : "border-ink/40 hover:border-ink"
                              }`}
                            >
                              {h}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t-2 border-ink bg-kraft/10 px-4 py-3">
          <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
            Aadhaar · payment have their own screens
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border-2 border-ink/30 px-4 py-2 font-mono text-[13px] uppercase tracking-[0.2em] hover:border-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving || loading}
              className="border-2 border-ink bg-ink px-5 py-2 font-mono text-[13px] font-bold uppercase tracking-[0.2em] text-bone hover:bg-rust disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
      <CameraCapture
        open={cameraOpen}
        title="Replace athlete photo"
        facing="user"
        onCancel={() => setCameraOpen(false)}
        onCapture={(blob) => void onPhotoCaptured(blob)}
      />
    </div>
  );
}

const inputCls =
  "h-9 w-full border-2 border-ink/40 bg-bone px-2 text-sm focus:border-ink focus:outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block font-mono text-[12px] uppercase tracking-[0.2em] text-ink/50">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
