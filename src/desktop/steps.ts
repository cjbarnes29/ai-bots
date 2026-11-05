import { z } from "zod";

/**
 * The CLOSED list of things a worker can ask the desktop engine to do, as data. There is no step that runs a command, a script or a program by path:
 * `launch` takes an application id from the owner's approved list. Steps that can lose or replace data are marked destructive and need the explicit flag
 * `allowDestructive` on the whole run (which the owner sees in the approval).
 */
const text = (max: number) => z.string().min(1).max(max);

export const targetSchema = z
  .strictObject({
    name: text(120).optional(),
    nameContains: text(120).optional(),
    type: z.enum(["Button", "CheckBox", "RadioButton", "Edit", "Document", "ComboBox", "ListItem", "MenuItem", "TabItem", "Text", "Hyperlink", "TreeItem", "DataItem", "Group", "Pane", "Window", "List", "Menu", "ToolBar", "Tab", "Tree", "Image", "Custom"]).optional(),
    automationId: text(100).optional(),
    /** Which one, when several match (0 = first). Without it, an ambiguous target is refused. */
    index: z.number().int().min(0).max(50).optional(),
  })
  .refine((t) => t.name || t.nameContains || t.automationId, { message: "A target needs a name, part of a name, or an automation id." });
export type Target = z.infer<typeof targetSchema>;

const windowSel = z.strictObject({ titleContains: text(120) }).optional();

export const expectSchema = z
  .strictObject({
    windowTitleContains: text(120).optional(),
    windowGone: text(120).optional(),
    control: targetSchema.optional(),
    controlGone: targetSchema.optional(),
    valueEquals: z.string().max(600).optional(),
    valueContains: z.string().max(200).optional(),
    toggle: z.enum(["On", "Off"]).optional(),
    withinMs: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((e) => e.windowTitleContains || e.windowGone || e.control || e.controlGone, { message: "An expectation needs a window title or a control." });
export type Expect = z.infer<typeof expectSchema>;

export const stepSchema = z.discriminatedUnion("do", [
  z.strictObject({ do: z.literal("launch"), app: z.string().regex(/^a[0-9a-f]{16}$/) }),
  z.strictObject({ do: z.literal("wait_window"), titleContains: text(120), timeoutMs: z.number().int().min(100).max(15_000).optional() }),
  z.strictObject({ do: z.literal("click"), target: targetSchema, window: windowSel, expect: expectSchema.optional(), expectDialog: text(120).optional() }),
  z.strictObject({ do: z.literal("toggle"), target: targetSchema, window: windowSel, expect: expectSchema.optional() }),
  z.strictObject({ do: z.literal("select"), target: targetSchema, window: windowSel, expect: expectSchema.optional() }),
  z.strictObject({ do: z.literal("focus"), target: targetSchema, window: windowSel }),
  z.strictObject({ do: z.literal("type"), target: targetSchema, text: z.string().min(0).max(2000), overwrite: z.boolean().optional(), window: windowSel }),
  z.strictObject({ do: z.literal("keys"), keys: text(200), window: windowSel, expect: expectSchema.optional() }),
  z.strictObject({ do: z.literal("read"), target: targetSchema, window: windowSel, maxChars: z.number().int().min(1).max(1000).optional() }),
  z.strictObject({ do: z.literal("read_screen"), window: windowSel }),
  z.strictObject({ do: z.literal("file_dialog"), mode: z.enum(["save", "open"]), path: text(400), overwrite: z.boolean().optional(), window: windowSel }),
  z.strictObject({ do: z.literal("close_window"), window: windowSel, discard: z.boolean().optional() }),
  z.strictObject({ do: z.literal("release") }),
]);
export type Step = z.infer<typeof stepSchema>;

export const runSchema = z
  .strictObject({
  /** Continue an earlier session (returned by an earlier run). Without it the run must start with a `launch` step. */
  session: z.string().regex(/^s[0-9a-f]{12}$/).optional(),
  steps: z.array(stepSchema).min(1).max(25),
  /** Must be true for any destructive step. The owner sees it in the approval. */
  allowDestructive: z.boolean().optional(),
  })
  .superRefine((r, ctx) => {
    // refused while the plan is still being asked for, so a destructive plan is never even sent to the owner without the flag
    if (!r.allowDestructive && r.steps.some(isDestructive)) ctx.addIssue({ code: "custom", message: "A step in this plan can lose or replace data (overwrite / discard). The plan must say allowDestructive: true so the owner is asked about it explicitly." });
  });
export type RunRequest = z.infer<typeof runSchema>;

export function isDestructive(s: Step): boolean {
  return (s.do === "type" && s.overwrite === true) || (s.do === "file_dialog" && s.overwrite === true) || (s.do === "close_window" && s.discard === true);
}

const tgt = (t: Target) => t.name ?? (t.nameContains ? `*${t.nameContains}*` : `#${t.automationId}`);

/** One plain line per step for the approval screen. Typed text is shown only as a length, never its content. */
export function describeStep(s: Step): string {
  switch (s.do) {
    case "launch": return `Start the approved application ${s.app}`;
    case "wait_window": return `Wait for a window titled *${s.titleContains}*`;
    case "click": return `Click "${tgt(s.target)}"`;
    case "toggle": return `Switch "${tgt(s.target)}"`;
    case "select": return `Select "${tgt(s.target)}"`;
    case "focus": return `Move the keyboard focus to "${tgt(s.target)}"`;
    case "type": return `Type ${s.text.length} characters into "${tgt(s.target)}"${s.overwrite ? " - REPLACES the text already there (irreversible)" : " (only if the field is empty)"}`;
    case "keys": return `Press the keys ${s.keys}`;
    case "read": return `Read the text of "${tgt(s.target)}"`;
    case "read_screen": return "Read the window with local OCR (the picture stays on this PC and is deleted)";
    case "file_dialog": return `${s.mode === "save" ? "Save as" : "Open"} ${s.path}${s.overwrite ? " - REPLACES the file if it exists (irreversible)" : ""}`;
    case "close_window": return `Close the window${s.discard ? " and DISCARD unsaved work (irreversible)" : " (refused if it holds unsaved work)"}`;
    case "release": return "Stop controlling the application";
  }
}
