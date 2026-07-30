# RankEngine AI — What We Learned Building This

A retrospective note on the process, not just the product — for the team, and for whoever picks up the next AI-agent-built internal tool after this one.

---

## 1. The product, in one paragraph

RankEngine AI started as a PRD for a SaaS SEO tool positioned around AI Overview visibility, and ended up as an internal company tool: a crawler-driven audit engine with LLM-synthesized checklists, a content editor tuned for how AI engines extract answers, keyword/backlink/competitor research via a licensed data provider (DataForSEO), AI visibility tracking across ChatGPT/Gemini/Perplexity/Google AI Overview, real traffic data via Search Console and GA4, and a chat assistant that ties all of that together. The pivot from multi-tenant SaaS to single-tenant internal tool, about two-thirds of the way through, turned out to be one of the most valuable decisions in the whole build — more on why below.

---

## 2. The single biggest lesson: "the code exists" and "the feature works" are different claims

This came up over and over, in different disguises:

- The audit checklist's "Passed" category was always empty — the code to generate it simply never wrote it, even though everything around it worked.
- `rawResultsRef` silently pointed at a fake placeholder string because a Python worker and a Node.js listener used two different field names for the same value, and nothing failed loudly — it just quietly stored the wrong thing.
- The sidebar's "Audit / Checklist" nav link was permanently disabled because a lookup table was missing two entries — the feature behind it was fully built and worked perfectly, but nobody could reach it through the normal path.
- The global rate limiter was completely disabled during every test run (`NODE_ENV === 'test'` bypassed it entirely), so the test suite was structurally incapable of catching the exact bug that was breaking real usage.
- A large refactor (removing auth/billing) deleted 19 test files in one sweep, including a dozen that had nothing to do with auth or billing — the features they protected were still fully present in the code, just now with zero coverage.

None of these were caught by "the tests pass" or "the code looks right on read-through." Every single one required either running the actual thing end to end, or reading the code specifically looking for the seam between two components (a field name, a lookup table, a test-mode bypass) rather than reading each component in isolation and assuming they'd connect correctly.

**The practical takeaway that shaped everything after this was discovered:** later prompts stopped accepting "should work" as a deliverable and started requiring an explicit list of things to actually click through, with the rule that a feature only counts as done once someone (agent or human) personally did the thing and confirmed the real result — not read the code and inferred the result.

---

## 3. Bugs cluster at the seams, not inside the components

Almost every real bug found in this build lived in the connective tissue between two pieces, not inside either piece on its own:

- Python worker <-> Node.js status sync (the `rawResultsRef`/`crawlResultId` field name mismatch)
- Frontend <-> nginx <-> API (the 405 routing bug — nginx had no idea `/api/*` needed to go anywhere but its static file handler)
- Registration <-> project creation (the "No organization found for user" bug — one flow assumed data the other flow hadn't reliably created)
- Test environment <-> real environment (the rate limiter, invisible in tests, active and wrong in production)

If there's one thing worth carrying into every future feature: **the riskiest code to skip verifying is the handoff, not the logic on either side of it.** Each side can be individually correct and the seam between them still broken.

---

## 4. "It passed on my machine" is not evidence, it's a hypothesis

Twice in this build, a working local setup masked a real problem:

- Committed `node_modules` containing macOS-built native binaries (bcrypt, then later Vite's Rolldown bundler) worked fine on the original developer's Mac and broke immediately in a Linux environment — not a code bug, a portability bug, invisible until someone ran it somewhere else.
- The 15-minute rate-limit window looked generous in isolated testing and fell apart the moment someone actually used the app the way it's meant to be used (a 3-second polling loop during an audit).

Neither of these would show up in "I ran it and it worked." They only show up when the *usage pattern* or the *environment* changes — which is exactly what happens the moment real people start using something instead of the person who built it.

---

## 5. Big refactors need a before/after test inventory, not just a before/after feature list

The auth/billing removal is the clearest example: it was scoped correctly as a feature removal (auth, orgs, billing all cleanly gone, zero dangling references — genuinely well executed on that axis) but nobody checked whether the *test files being deleted* actually corresponded 1:1 with the *features being removed*. They didn't. The blast radius of "delete everything that mentions auth" was wider than "delete auth" — style/pattern matching swept up unrelated coverage.

**The fix that generalizes:** any prompt that removes a subsystem should explicitly require a diff review of what test coverage existed before and after, with a rule that coverage for anything NOT being removed must be preserved or explicitly, deliberately rewritten — not silently lost as collateral damage.

---

## 6. The SaaS-to-internal-tool pivot was the right call, and it wasn't just a scope cut

Going from multi-tenant to single-tenant didn't just remove work, it removed a category of risk:

- No more per-customer OAuth consent flows for the GSC/GA4 integration — one service account, granted access once, done.
- No more cross-tenant data isolation to get right (this was flagged as the single highest-risk piece of the whole build when multi-tenancy still existed — a mistake there is a security bug, not a UX bug).
- No more plan-tier gating logic sitting on top of every feature, which is its own surface area for bugs (and, worth naming honestly, its own source of a worse user experience — nobody enjoys hitting an upgrade wall).

**The generalizable lesson:** scope reduction that removes a whole category of correctness requirements (not just lines of code) is worth more than it looks like on paper. This is different from just "doing less" — it's doing less of the specific thing that was generating the highest-stakes bugs.

---

## 7. Cost control has to be designed in, not bolted on

The AI Visibility toolkit (checking ChatGPT/Gemini/Perplexity/Google AI Overview daily, per tracked prompt) turned out to be the dominant cost line by a wide margin in every cost model built for this product — not because any single check is expensive, but because "daily x every engine x every tracked prompt" compounds fast, and Perplexity's flat per-request fee in particular doesn't care how small the query is.

This is the kind of cost driver that's invisible in a feature spec ("track AI visibility across major engines" sounds like one line of scope) and only becomes obvious once you actually model usage volume. **The lesson: any feature that calls a metered external API on a recurring schedule needs its cost modeled at real usage volume before it ships, not after the first bill.** Frequency (daily vs. weekly) is usually the actual lever, not the per-call price.

---

## 8. What worked well in how this was built, worth repeating

- **A context primer at the start of every session.** Coding agents have no memory between sessions — re-establishing architecture, conventions, and known issues every time avoided both re-scaffolding and inconsistent "fixes" that didn't match existing patterns.
- **Explicit contracts over open judgment calls, especially for faster/cheaper models.** The DeepSeek V4 Flash-oriented prompts (exact JSON shapes, exact thresholds, exact file paths, mandatory named test cases) produced work that matched spec closely — verified directly against the resulting code. Vague instructions like "handle this reasonably" are where smaller/faster models improvise incorrectly; specificity is a substitute for the reasoning depth they don't have as much of.
- **Root-cause discipline before fixing.** Every real bug in this build got diagnosed by reproducing it and tracing the actual failure, not by pattern-matching to a plausible cause and writing a fix for that instead. This is slower per-bug and produced fixes that actually held.
- **Treating "fix this" and "verify this stays fixed" as two separate deliverables.** Several fix prompts explicitly required a new test that would have caught the original bug — not just a patch to the symptom.

---

## 9. What we'd do differently starting over

- **Write the test-inventory-preservation rule into the very first refactor prompt**, not discover the need for it after 19 test files were already gone.
- **Model API cost at realistic usage volume during feature design**, not after the feature is built — the AI Visibility frequency decision should have been made with the cost model in hand, not retrofitted.
- **Exclude `node_modules`/build artifacts from version control or zips from day one** — this caused real, repeated friction (bcrypt, then Rolldown) that a one-line `.gitignore` entry would have prevented entirely.
- **Decide single-tenant vs. multi-tenant before building auth**, not after building a full multi-tenant system and then removing it. The removal was clean, but it was still removal — the org/billing/team work had real value only for a version of the product that didn't ship.

---

## 10. The honest summary

Most of what actually went wrong in this build wasn't bad logic — individual functions, individual endpoints, individual components were usually implemented correctly on their own terms. What went wrong was almost always at a boundary: between two services, between test and production, between what was removed and what should have stayed, between what a feature costs to build and what it costs to run. That's probably the single most transferable lesson for whatever gets built next: spend the extra scrutiny at the seams, not just inside the box.
