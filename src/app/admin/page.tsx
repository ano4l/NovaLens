"use client";

import { useEffect, useState } from "react";

const MODEL_OPTIONS = [
  { id: "qwen/qwen3-vl-235b-a22b-instruct", label: "Qwen3 VL 235B Instruct", note: "Visual detail and markings" },
  { id: "qwen/qwen3-vl-235b-a22b-thinking", label: "Qwen3 VL 235B Thinking", note: "Independent visual reasoning" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", note: "Frontier multimodal analyst" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini", note: "Cost-controlled adjudicator" },
  { id: "dots-studio/dots-3-note-preview:free", label: "Dots3 Note Preview", note: "Free prototype model" },
  { id: "openrouter/free", label: "OpenRouter Free Router", note: "Random free availability route" },
];

const GROUPS = [
  {
    title: "Routing",
    description: "Tier 1 handles routine images. Escalations use two independent analysts and an adjudicator.",
    fields: [
      { key: "tier1_model", label: "Tier 1 model", kind: "model" },
      { key: "tier2_model", label: "Tier 2 model", kind: "model" },
      { key: "challenger_model", label: "Independent challenger", kind: "model" },
      { key: "adjudicator_model", label: "Consensus adjudicator", kind: "model" },
      { key: "escalation_threshold", label: "Escalation threshold", hint: "0 to 1. Higher sends more uncertain items to Tier 2." },
      { key: "max_attempts", label: "Attempts per image", hint: "1 to 10 before manual review." },
    ],
  },
  {
    title: "Cost model",
    description: "These rates drive forecasts. Actual charged cost is captured from each OpenRouter response.",
    fields: [
      { key: "tier1_input_rate", label: "Tier 1 input / 1M tokens" },
      { key: "tier1_output_rate", label: "Tier 1 output / 1M tokens" },
      { key: "tier2_input_rate", label: "Tier 2 input / 1M tokens" },
      { key: "tier2_output_rate", label: "Tier 2 output / 1M tokens" },
      { key: "batch_discount", label: "Batch discount", hint: "0 for free models; 0.5 means a 50% discount." },
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

  const applyQualityConsensus = () => {
    setSettings((current) => ({
      ...current,
      tier1_model: "qwen/qwen3-vl-235b-a22b-instruct",
      tier2_model: "google/gemini-3.1-pro-preview",
      challenger_model: "qwen/qwen3-vl-235b-a22b-thinking",
      adjudicator_model: "openai/gpt-5.4-mini",
    }));
    setState("idle");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400 mb-3">System controls</p>
          <h1 className="page-title">Pipeline configuration</h1>
          <p className="page-intro mt-3">Model routing, forecasts, retry policy, and safety thresholds. Changes apply to the next model call.</p>
        </div>
        <button onClick={save} disabled={state === "loading" || state === "saving"} className="primary-button px-5 py-2.5 disabled:opacity-50">
          {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="panel p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Recommended quality consensus</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">Qwen handles fine visual detail, Gemini challenges the identification, and GPT adjudicates disagreements. Exact charged cost is recorded from OpenRouter.</p>
        </div>
        <button type="button" onClick={applyQualityConsensus} className="secondary-button px-4 py-2.5 text-sm">Apply pairing</button>
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
          <h2 className="font-medium">OpenRouter connection</h2>
          <p className="text-sm text-zinc-500 mt-1">Set <code className="text-amber-300">OPENROUTER_API_KEY</code> in <code className="text-amber-300">.env</code>. Without it, NovaLens safely uses mock results.</p>
        </div>
        <span className="self-start sm:self-auto rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Server-side secret</span>
      </div>

      <div className="panel p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Background removal</h2>
          <p className="text-sm text-zinc-500 mt-1">Set <code className="text-amber-300">REMOVE_BG_API_KEY</code> to create a transparent cutout and a clean white-background image at upload time.</p>
        </div>
        <span className="self-start sm:self-auto rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Optional provider</span>
      </div>
    </div>
  );
}
