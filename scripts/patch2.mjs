import { readFileSync, writeFileSync } from "node:fs";
const edit = (f, fn) => { let s = readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n"); s = fn(s); writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s); };
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error("missing: " + a.slice(0, 70)); return s.replace(a, b); };
edit("src/business/markets.ts", (s) => rep(s, "export function getMarket(code: string): Market {\n  const m = MARKETS[code.toUpperCase()];",
`/** Names a model naturally writes for the country code (seen in the first real run: "uae"). They mean the same market. */
const MARKET_ALIASES: Record<string, string> = { UAE: "AE", "UNITED ARAB EMIRATES": "AE", EMIRATES: "AE", "U.A.E.": "AE" };

export function getMarket(code: string): Market {
  const key = code.trim().toUpperCase();
  const m = MARKETS[MARKET_ALIASES[key] ?? key];`));
edit("src/manager/service.ts", (s) => {
  s = rep(s, "    const first = parseJsonReply(await this.ask(id, system, user, s.model), schema);", "    const first = parseJsonReply(await this.ask(id, system, user, s.model, JSON_REPLY_TOKENS), schema);");
  s = rep(s, "await this.ask(id, system, `${user}\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object.`, s.escalationModel), schema);", "await this.ask(id, system, `${user}\n\nYour previous reply was not valid JSON in the required shape. Reply with ONLY the JSON object.`, s.escalationModel, JSON_REPLY_TOKENS), schema);");
  s = rep(s, "const MAX_RESULT_CHARS = 20_000;", "const MAX_RESULT_CHARS = 20_000;\n/** Room for a reasoning model to think AND answer. The first real run (2026-11-05) lost its final review to an empty reply because 1,500 tokens were all spent on reasoning. */\nconst JSON_REPLY_TOKENS = 4000;");
  // a failed final review must not throw away finished work
  s = rep(s, "      let review = await this.review(id, run.goal, settings);", "      let review = await this.reviewOrFallback(id, run.goal, settings);");
  s = rep(s, "          review = await this.review(id, run.goal, settings, true);", "          review = await this.reviewOrFallback(id, run.goal, settings, true);");
  s = rep(s, "  private async review(id: string, goal: string, settings: ManagerSettings, last = false) {", `  /**
   * The final review is a quality check, not the work. If the model cannot do it (empty reply, provider trouble) the finished step results are NOT thrown
   * away: the run completes with those results and says plainly that they were not reviewed. A cancel or a used-up budget still stop the run as before.
   */
  private async reviewOrFallback(id: string, goal: string, settings: ManagerSettings, last = false) {
    try {
      return await this.review(id, goal, settings, last);
    } catch (err) {
      if (err instanceof BudgetExhausted || (err instanceof AppError && (err.code === "manager_cancelled" || err.code === "run_cancelled"))) throw err;
      const reason = err instanceof Error ? clip(err.message, 300) : "the model could not answer";
      this.d.audit.record("manager.review_failed", { id, reason }, { actor: "system" });
      const done = this.view(id).steps.filter((x) => x.status === "completed" && x.output);
      const body = done.map((x) => \`## \${x.title} (\${x.specialistName ?? "Manager"})\n\${clip(x.output ?? "", 3000)}\`).join("\n\n");
      return { verdict: "pass" as const, issues: "", fixSteps: [] as string[], final: \`NOT REVIEWED: the Manager's final check could not be done (\${reason}). These are the step results exactly as they came back.\n\n\${body}\` };
    }
  }

  private async review(id: string, goal: string, settings: ManagerSettings, last = false) {`);
  return s;
});
