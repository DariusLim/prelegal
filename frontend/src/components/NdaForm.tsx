"use client";

import { useState, type ReactNode } from "react";

import type { NdaFormData, Party } from "@/lib/nda/types";

const MAX_YEARS = 99;

const inputClass =
  "mt-1 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-stone-500 focus:outline-none focus:ring-2 focus:ring-stone-200";

const groupLabelClass = "text-sm font-medium text-stone-800";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={groupLabelClass}>{label}</span>
      {hint && <span className="ml-1 text-xs text-stone-500">{hint}</span>}
      {children}
    </label>
  );
}

interface TextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function TextInput({ value, onChange, placeholder }: TextProps) {
  return (
    <input className={inputClass} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  );
}

function TextArea({ value, onChange, rows }: TextProps & { rows: number }) {
  return <textarea rows={rows} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-stone-500">{title}</legend>
      {children}
    </fieldset>
  );
}

/** A native radio group: shared `name` gives arrow-key navigation; legend names the group. */
function RadioGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className={groupLabelClass}>{legend}</legend>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </fieldset>
  );
}

function Radio({ name, checked, onSelect, children }: { name: string; checked: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2">
      <input type="radio" name={name} checked={checked} onChange={onSelect} />
      {children}
    </label>
  );
}

/**
 * Whole-number years input (1–99). Keeps a local draft so the field can be
 * cleared while typing; only valid values are reported, and an invalid draft
 * reverts to the last valid value on blur.
 */
function YearsInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(String(value));

  return (
    <span className="inline-flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "").slice(0, String(MAX_YEARS).length);
          setDraft(digits);
          const years = Number(digits);
          if (years >= 1) onChange(years);
        }}
        onBlur={() => setDraft(String(value))}
        className="w-14 rounded-md border border-stone-300 px-2 py-1 text-sm disabled:bg-stone-100 disabled:text-stone-400"
      />
      year(s) from Effective Date
    </span>
  );
}

function PartyFields({ label, party, onChange }: { label: string; party: Party; onChange: (patch: Partial<Party>) => void }) {
  return (
    <Section title={label}>
      <Field label="Company">
        <TextInput value={party.company} onChange={(company) => onChange({ company })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signatory name">
          <TextInput value={party.name} onChange={(name) => onChange({ name })} />
        </Field>
        <Field label="Title">
          <TextInput value={party.title} onChange={(title) => onChange({ title })} />
        </Field>
      </div>
      <Field label="Notice address" hint="email or postal address">
        <TextInput value={party.noticeAddress} onChange={(noticeAddress) => onChange({ noticeAddress })} />
      </Field>
    </Section>
  );
}

interface NdaFormProps {
  data: NdaFormData;
  today: string;
  onChange: (patch: Partial<NdaFormData>) => void;
}

/** Controlled form for the Mutual NDA Cover Page fields. */
export function NdaForm({ data, today, onChange }: NdaFormProps) {
  return (
    <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
      <Section title="Agreement">
        <Field label="Purpose" hint="how Confidential Information may be used">
          <TextArea rows={3} value={data.purpose} onChange={(purpose) => onChange({ purpose })} />
        </Field>

        <Field label="Effective date">
          <input
            type="date"
            className={inputClass}
            value={data.effectiveDate || today}
            onChange={(e) => onChange({ effectiveDate: e.target.value })}
          />
        </Field>

        <RadioGroup legend="MNDA term">
          <div className="flex flex-wrap items-center gap-2">
            <Radio
              name="mndaTermType"
              checked={data.mndaTermType === "expires"}
              onSelect={() => onChange({ mndaTermType: "expires" })}
            >
              Expires after
            </Radio>
            <YearsInput
              label="MNDA term in years"
              value={data.mndaTermYears}
              disabled={data.mndaTermType !== "expires"}
              onChange={(mndaTermYears) => onChange({ mndaTermYears })}
            />
          </div>
          <Radio
            name="mndaTermType"
            checked={data.mndaTermType === "untilTerminated"}
            onSelect={() => onChange({ mndaTermType: "untilTerminated" })}
          >
            Continues until terminated
          </Radio>
        </RadioGroup>

        <RadioGroup legend="Term of confidentiality">
          <div className="flex flex-wrap items-center gap-2">
            <Radio
              name="confidentialityType"
              checked={data.confidentialityType === "years"}
              onSelect={() => onChange({ confidentialityType: "years" })}
            >
              Fixed term of
            </Radio>
            <YearsInput
              label="Confidentiality term in years"
              value={data.confidentialityYears}
              disabled={data.confidentialityType !== "years"}
              onChange={(confidentialityYears) => onChange({ confidentialityYears })}
            />
          </div>
          <Radio
            name="confidentialityType"
            checked={data.confidentialityType === "perpetual"}
            onSelect={() => onChange({ confidentialityType: "perpetual" })}
          >
            In perpetuity
          </Radio>
        </RadioGroup>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Governing law" hint="state">
            <TextInput placeholder="Delaware" value={data.governingLaw} onChange={(governingLaw) => onChange({ governingLaw })} />
          </Field>
          <Field label="Jurisdiction" hint="city/county and state">
            <TextInput
              placeholder="courts located in New Castle, DE"
              value={data.jurisdiction}
              onChange={(jurisdiction) => onChange({ jurisdiction })}
            />
          </Field>
        </div>

        <Field label="MNDA modifications" hint="optional">
          <TextArea rows={2} value={data.modifications} onChange={(modifications) => onChange({ modifications })} />
        </Field>
      </Section>

      <PartyFields
        label="Party 1"
        party={data.party1}
        onChange={(patch) => onChange({ party1: { ...data.party1, ...patch } })}
      />
      <PartyFields
        label="Party 2"
        party={data.party2}
        onChange={(patch) => onChange({ party2: { ...data.party2, ...patch } })}
      />
    </form>
  );
}
