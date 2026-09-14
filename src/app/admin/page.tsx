"use client";

import { useEffect, useState } from "react";

const MODEL_OPTIONS = [
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", note: "Stable multimodal recognition and rechecks" },
];

const GROUPS = [
  {
    title: "Recognition routing",
    description: "Tier 1 handles routine images. Tier 2 performs higher-quality escalations and field rechecks through Google AI.",
    fields: [
      { key: "tier1_model", label: "Tier 1 model", kind: "model" },
      { key: "tier2_model", label: "Tier 2 model", kind: "model" },
      { key: "escalation_threshold", label: "Escalation threshold", hint: "0 to 1. Higher sends more uncertain items to Tier 2." },
      { key: "max_attempts", label: "Attempts per image", hint: "1 to 10 before manual review." },
    ],
  },
  {
    title: "Cost model",
    description: "These rates drive internal forecasts for Google AI recognition usage.",
    fields: [
      { key: "tier1_input_rate", label: "Tier 1 input / 1M tokens" },
      { key: "tier1_output_rate", label: "Tier 1 output / 1M tokens" },
      { key: "tier2_input_rate", label: "Tier 2 input / 1M tokens" },
      { key: "tier2_output_rate", label: "Tier 2 output / 1M tokens" },
      { key: "batch_discount", label: "Batch discount", hint: "Keep at 0 for synchronous calls; use 0.5 only when the Gemini Batch API is actually enabled." },
    ],
  },
  {
    title: "Forecasts and guardrails",
    description: "Tune estimates and decide when a completed run needs attention.",
    fields: [
      { key: "est_input_tokens_per_image", label: "Input tokens / image" },
      { key: "est_output_tokens_per_image", label: "Output tokens / image" },
      { key: "est_escalation_rate", label: "Expected escalation rate" },
      { key: "guardrail_margin", label: "Cost margin" },
      { key: "escalation_rate_alert_high", label: "Escalation alert threshold" },
    ],
  },
] as const;

export default function AdminPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load settings");
        setSettings(data.settings);
        setState("idle");
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setState("idle");
      });
  }, []);

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save configuration");
      setSettings(data.settings);
      setState("saved");
      setTimeout(() => setState("idle"), 2200);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setState("idle");
    }
  };

  const applyRecommendedModel = () => {
    setSettings((current) => ({
      ...current,
      tier1_model: "gemini-3.6-flash",
      tier2_model: "gemini-3.6-flash",
    }));
    setState("idle");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div>
          <p className="eyebrow">System controls</p>
          <h1 className="page-title">Recognition settings</h1>
          <p className="page-intro mt-3">Model routing, forecasts, retry policy, and safety thresholds. Changes apply to the next model call.</p>
        </div>
        <button onClick={save} disabled={state === "loading" || state === "saving"} className="primary-button px-5 py-2.5 disabled:opacity-50">
          {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="panel p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Recommended Gemini model</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">Direct Google AI recognition keeps the provider secret server-side and uses Gemini 3.6 Flash for routine work, escalations, and field rechecks.</p>
        </div>
        <button type="button" onClick={applyRecommendedModel} className="secondary-button px-4 py-2.5 text-sm">Use Gemini 3.6 Flash</button>
      </section>

      <div className="grid gap-5">
        {GROUPS.map((group) => (
          <section key={group.title} className="panel overflow-hidden">
            <div className="p-5 sm:p-6 border-b border-zinc-800">
              <h2 className="text-lg font-semibold">{group.title}</h2>
              <p className="text-sm text-zinc-500 mt-1">{group.description}</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-5 p-5 sm:p-6">
              {group.fields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={field.key} className="block text-sm text-zinc-300 mb-2">{field.label}</label>
                  {"kind" in field && field.kind === "model" ? (
                    <select id={field.key} value={settings[field.key] ?? ""} onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))} className="field px-3.5 py-3">
                      {!MODEL_OPTIONS.some((model) => model.id === settings[field.key]) && settings[field.key] && <option value={settings[field.key]}>{settings[field.key]}</option>}
                      {MODEL_OPTIONS.map((model) => <option key={model.id} value={model.id}>{model.label} - {model.note}</option>)}
                    </select>
                  ) : (
                    <input id={field.key} inputMode="decimal" value={settings[field.key] ?? ""} onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))} className="field data-value px-3.5 py-3" />
                  )}
                  {"hint" in field && field.hint && <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{field.hint}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="panel p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Google AI connection</h2>
          <p className="text-sm text-zinc-500 mt-1">Set <code>GEMINI_API_KEY</code> in the server environment. Without it, NovaLens safely uses mock results. The key is never sent to the browser.</p>
        </div>
        <span className="self-start sm:self-auto rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Server-side secret</span>
      </div>

    </div>
  );
}
