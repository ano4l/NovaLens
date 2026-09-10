// ============================================================================
// STUDY: Next.js runs register() ONCE when the server process boots. This is
// the official hook for "start background machinery" — here it launches the
// polling worker in the same process. The NEXT_RUNTIME check matters: Next
// also boots an "edge" runtime where the Node Postgres client can't load.
// ============================================================================
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker } = await import("@/lib/worker");
    startWorker();
  }
}
