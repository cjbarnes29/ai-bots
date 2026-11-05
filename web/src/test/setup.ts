import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Be patient on a busy machine: wait up to 4s (default 1s) for things to appear.
configure({ asyncUtilTimeout: 4000 });

afterEach(() => {
  cleanup();
  if (typeof sessionStorage !== "undefined") sessionStorage.clear(); // the open-workspaces strip remembers pages per browser tab; tests must not share that
  vi.unstubAllGlobals();
});
