import { useEffect } from "react";

/**
 * iOS Safari (including installed-PWA/standalone mode) doesn't shrink the
 * layout viewport when the on-screen keyboard opens or the address bar
 * toggles — `height: 100%` on html/body stays pinned to the *initial*
 * viewport, so fixed-height panels (like the project terminal) end up
 * partially hidden behind the keyboard instead of resizing above it.
 * `visualViewport` reports the actually-visible height; we mirror it into
 * a CSS var that `--app-vh` consumers (see styles/index.css) use instead
 * of a bare `100%`.
 */
export function useDynamicViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;

    const setHeight = () => {
      const height = viewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${height}px`);
    };

    setHeight();
    viewport?.addEventListener("resize", setHeight);
    window.addEventListener("orientationchange", setHeight);
    // Fallback for browsers without visualViewport support.
    window.addEventListener("resize", setHeight);

    return () => {
      viewport?.removeEventListener("resize", setHeight);
      window.removeEventListener("orientationchange", setHeight);
      window.removeEventListener("resize", setHeight);
    };
  }, []);
}
