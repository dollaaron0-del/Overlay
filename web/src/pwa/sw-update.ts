/**
 * Makes a deployed update actually reach an open tab.
 *
 * The service worker (configured in vite.config.ts) answers every navigation
 * from its own precache, so reloading right after a deploy re-renders the
 * *old* bundle: the browser only notices the changed sw.js while that old
 * page is already on screen, and the new assets are picked up one reload
 * later. Measured against a real build, the new bundle first appeared on the
 * second reload — which is why hitting refresh looked like it did nothing.
 *
 * Two things fix that: reload once as soon as a new worker takes over (so the
 * user's single refresh is enough), and actively ask for a new worker instead
 * of only checking during page load.
 */

const UPDATE_CHECK_INTERVAL_MS = 60_000;

export function setupServiceWorkerUpdates(): void {
  if (!("serviceWorker" in navigator)) return;

  // A page loaded straight from the network has no controller until the very
  // first worker claims it. That claim is not an update — the page already
  // matches what the worker would serve — so reloading for it would just cost
  // a pointless flash on a first visit.
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!wasControlled || reloading) return;
    reloading = true;
    window.location.reload();
  });

  void navigator.serviceWorker.ready.then((registration) => {
    // update() rejects on a flaky/offline network; that's a normal state for
    // a dashboard on a laptop that sleeps, and the next check retries anyway.
    const check = () => void registration.update().catch(() => {});

    setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
  });
}
