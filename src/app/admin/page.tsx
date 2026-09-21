"use client";

import { useEffect, useState } from "react";

const GROUPS = [
  {
    title: "Google Lens review routing",
    description: "Every image is matched through SerpApi Google Lens and held for human confirmation. No separate AI model is used.",
    fields: [
      { key: "max_attempts", label: "Attempts per image", hint: "1 to 10 before manual review." },
    ],
  },
  {
    title: "Review guardrails",
    description: "Keep Lens candidates visible for review and flag batches that need attention.",
    fields: [
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

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-5">
        <div>
          <p className="eyebrow">System controls</p>
          <h1 className="page-title">Recognition settings</h1>
          <p className="page-intro mt-3">SerpApi Google Lens routing, retry policy, and review thresholds. Changes apply to the next match.</p>
        </div>
        <button onClick={save} disabled={state === "loading" || state === "saving"} className="primary-button px-5 py-2.5 disabled:opacity-50">
          {state === "saving" ? "Saving..." : state === "saved" ? "Saved" : "Save changes"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-lg border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>}

      <section className="panel p-5 sm:p-6">
        <div>
          <h2 className="font-medium">Google Lens only</h2>
          <p className="text-sm text-zinc-500 mt-1 max-w-2xl">SerpApi Google Lens is the only recognition provider. Results remain external match candidates until a reviewer confirms or edits the catalogue fields.</p>
        </div>
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
                  <input id={field.key} inputMode="decimal" value={settings[field.key] ?? ""} onChange={(event) => setSettings((current) => ({ ...current, [field.key]: event.target.value }))} className="field data-value px-3.5 py-3" />
                  {"hint" in field && field.hint && <p className="text-xs text-zinc-500 mt-2 leading-relaxed">{field.hint}</p>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="panel p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium">Recognition connections</h2>
          <p className="text-sm text-zinc-500 mt-1">Set <code>SERPAPI_KEY</code> for live Google Lens matching. The key remains server-side.</p>
        </div>
        <span className="self-start sm:self-auto rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">Server-side secret</span>
      </div>

    </div>
  );
}
