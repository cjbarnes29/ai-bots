import type { FolderOp } from "./store.js";

/** What a connector needs from the folder permission system: ask, and get an Error with a plain-language reason if the answer is no. */
export interface FolderGate {
  require(input: { subject: string; path: string; op: FolderOp; isDirectory?: boolean }): unknown;
}
