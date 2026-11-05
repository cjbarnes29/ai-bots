import { useEffect, useState } from "react";

const QUERY = "(max-width: 767px)";

/** True on phone-sized screens (under 768 px). Where the browser cannot tell (older browsers, tests) it says false, so the wide layout is the default. */
export function useNarrow(): boolean {
  const can = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [narrow, setNarrow] = useState(() => (can ? window.matchMedia(QUERY).matches : false));
  useEffect(() => {
    if (!can) return;
    const m = window.matchMedia(QUERY);
    const on = () => setNarrow(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [can]);
  return narrow;
}
