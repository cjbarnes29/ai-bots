/* Real model output from the P-44 run 2 (Groq; fictional cafe topic), used to measure workspace context size with realistic text. Results were clipped to 1,500 characters in the evidence. */
export const RUN2 = {
 "researcher": {
  "result": "I'll research the three items for a specialty cafe in Dubai Marina, using my own knowledge only (no web access), and label each honestly.\n\nKey context first: Dubai's food & beverage licensing is handled by DED (Dubai Economy) plus a DHA/food safety permit and a municipal trade licence; \"typical\" numbers vary a lot by trade class, unit size, and whether you franchise or operate under a master landlord. I'll give ranges and say plainly they are estimates unless I can attach a source.\n\n1) Typical yearly licence cost (F&B, Dubai mainland)\n- DED trade licence for a small F&B business: roughly AED 12,000–25,000/year for the licence itself, plus establishment card, name reservation, initial approval, and notary fees.\n- Food safety / DHA food permit and municipal health inspection fees: roughly AED 2,000–10,000/year.\n- If you also need a PRO/residence sponsor, visa and medical for staff, that is separate (often AED 3,500–7,000 per person per year).\n- Honest label: ESTIMATE / assumption. I do not have a current published DED fee schedule in front of me, so treat these as planning ranges, not verified facts.\n\n2) Yearly rent for a small unit in Dubai Marina\n- \"Small unit\" for a specialty cafe is typically 400–800 sq ft.\n- Marina street-level or ground-floor retail in a mid-tier corridor: roughly AED 1,500–2,500 per sq ft per year. For 500 sq ft that is roughly AED 750,000–1,250,000/year.\n- Upper-floor or non-street-facing units in the same area can be cheaper: roughly AED 800–1,500 per ",
  "entries": [
   {
    "kind": "assumption",
    "title": "Small-unit rent in Dubai Marina (estimate)",
    "text": "A 400–800 sq ft unit in Dubai Marina typically rents for about AED 1,500–2,500 per sq ft per year on street-level/mid-tier retail, i.e. roughly AED 750,000–1,250,000/year for ~500 sq ft. Upper-floor or non-street units can be AED 800–1,500 per sq ft per year. Market estimate, not a live listing.",
    "source": "general knowledge, no live source; estimate",
    "platformNote": null
   },
   {
    "kind": "assumption",
    "title": "Dubai F&B licence cost (estimate)",
    "text": "For a small specialty cafe on Dubai mainland, plan for roughly AED 15,000–35,000/year all-in for the DED trade licence plus food-safety/DHA permit and basic municipal fees, before staff visas/PRO. Ranges vary by trade class and unit size. This is a planning estimate from general knowledge, not a verified DED fee schedule.",
    "source": "general knowledge, no live source; estimate",
    "platformNote": null
   }
  ]
 },
 "analyst": {
  "result": "**Status of the requested file**\n\nThe request to create **marina‑costs.csv** has been sent for the owner’s approval (request e94c16ab‑23a2‑4c3f‑b9d0‑2c3d6739f93f).  \nIt has **not** been created yet and will only be generated once the owner approves the action.\n\n---\n\n### Yearly Fixed‑Cost Estimate (Licence + Rent)\n\n| Item | AED per year (estimate) |\n|------|--------------------------|\n| **Rent (small unit, ~500 sq ft, Dubai Marina)** | **≈ 1,000,000** |\n| **Food‑and‑Beverage licence (DED + DHA + municipal fees)** | **≈ 25,000** |\n| **Total Fixed Costs** | **≈ 1,025,000** |\n\n**How the numbers were derived**\n\n* **Rent** – Based on the assumption that a 400‑800 sq ft retail unit in Dubai Marina rents for AED 1,500‑2,500 per sq ft per year. Using a mid‑point of 500 sq ft gives a range of AED 750,000‑1,250,000; the estimate of AED 1,000,000 is a reasonable central value.  \n* **Licence** – General‑knowledge estimate for a small specialty café on the Dubai mainland: AED 15,000‑35,000 per year for the DED trade licence, DHA food‑safety permit, and basic municipal fees. The midpoint is AED 25,000.\n\nThese figures are **planning estimates**; actual costs can vary depending on the exact location, unit size, floor level, and the specific licence class required.\n\n---\n\n### Recommendation\n\n- **Budget using the central estimate (AED 1,025,000 per year)** but include a contingency band of **± AED 250,000** to cover the possible rent range (AED 750k‑1.25M) and licence range (AED 15k‑35k).  \n- Wh",
  "entries": [
   {
    "kind": "handover",
    "title": "Owner's Brief Draft",
    "text": "Please prepare the owner's brief summarising the cost assumptions, the total fixed‑cost estimate, and any recommended budgeting considerations.",
    "forName": "Writer P44"
   },
   {
    "kind": "recommendation",
    "title": "Yearly Fixed Cost Estimate",
    "text": "Based on the available assumptions, the yearly fixed costs for a small specialty café in Dubai Marina are estimated at AED 1,025,000 (AED 1,000,000 for rent and AED 25,000 for licensing). This figure should be used as a planning baseline, with a contingency added to cover the possible variation in both rent (AED 750,000‑1,250,000) and licence fees (AED 15,000‑35,000).",
    "forName": null
   }
  ]
 }
} as const;
