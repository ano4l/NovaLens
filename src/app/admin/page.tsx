// ============================================================================
// STUDY: The admin panel is a dumb client over the settings API: fetch all
// rows, render one input per key listed in FIELDS, PUT everything back on
// save. The UI knows NOTHING about what each setting means — the meaning lives
// in settings.ts readers (worker, cost, vision). Add a new tunable = one line
// in FIELDS + one default in db.ts DEFAULT_SETTINGS. That's the payoff of
// config-as-data.
// ============================================================================
"use client";

import { useEffect, useState } from "react";

const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "tier1_model", label: "Tier 1 model (bulk)", hint: "e.g. gemini-2.5-flash-lite" },
  { key: "tier2_model", label: "Tier 2 model (escalation)", hint: "e.g. gemini-2.5-pro" },
  { key: "escalation_threshold", label: "Escalation threshold (0–1)", hint: "Below this self-confidence, items escalate to Tier 2" },
  { key: "tier1_input_rate", label: "Tier 1 input $/1M tokens" },
  { key: "tier1_output_rate", label: "Tier 1 output $/1M tokens" },
  { key: "tier2_input_rate", label: "Tier 2 input $/1M tokens" },
  { key: "tier2_output_rate", label: "Tier 2 output $/1M tokens" },
  { key: "batch_discount", label: "Batch API discount (0–1)", hint: "0.5 = 50% off in batch mode" },
  { key: "est_input_tokens_per_image", label: "Est. input tokens / image" },
  { key: "est_output_tokens_per_image", label: "Est. output tokens / image" },
  { key: "est_escalation_rate", label: "Est. escalation rate (0–1)" },
  { key: "guardrail_margin", label: "Guardrail margin (0–1)", hint: "Alert if actual cost > estimate × (1 + margin)" },
  { key: "escalation_rate_alert_high", label: "Escalation rate alert (0–1)", hint: "Alert if a job escalates more than this fraction" },
  { key: "max_attempts", label: "Max attempts per image", hint: "Before marking needs_manual" },
];

export default function AdminPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => setSettings(d.settings));
  }, []);

  const save = async () => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Pipeline Configuration</h1>
      <p className="text-sm text-zinc-400 mb-6">
        Model routing, cost model, and guardrails. Changes apply to new processing immediately — no deploy needed.
      </p>

      <div className="space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label className="block text-sm text-zinc-300 mb-1">{f.label}</label>
            <input
              value={settings[f.key] ?? ""}
              onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value }))}
              className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 focus:border-amber-500 outline-none font-mono text-sm"
            />
            {f.hint && <p className="text-xs text-zinc-500 mt-1">{f.hint}</p>}
          </div>
        ))}
      </div>

      <button
        onClick={save}
        className="mt-6 px-5 py-2.5 rounded-md bg-amber-500 text-zinc-950 font-semibold hover:bg-amber-400"
      >
        {saved ? "Saved ✓" : "Save configuration"}
      </button>

      <div className="mt-10 rounded-md border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
        <div className="font-medium text-zinc-200 mb-1">Gemini API key</div>
        Set <code className="text-amber-400">GEMINI_API_KEY</code> in <code className="text-amber-400">.env</code> to
        enable live Gemini calls. Without a key, the pipeline runs with a mock vision client so you can exercise the
        full upload → tag → escalate → review → export flow offline.
      </div>
    </div>
  );
}
