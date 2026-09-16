# Incident Process chips don't change — root cause & fix

**Symptom:** On an **Incident Report** record the sidecar shows its suggested‑prompt chips.
Navigate to an **Incident Process** record and the chips don't change.

**Bottom line:** The prompts are **already in the deployed pane bundle** — so the fastest fix is
**config‑only, no redeploy**: register Incident Process as a bound table and add the launcher to its
form (the two steps below). We've **also hardened the runtime** in this repo so that, once you take the
update, the pane self‑heals even when a form is missing the launcher handler — and it makes far fewer
Dataverse calls. See "What we shipped in this update" below.

---

## Root cause (verified in the runtime code)

The sidecar treats a form as "in scope" only when that table has an **enabled target binding**
(`maftagsc_targetbinding`) on the sidecar configuration. Two things are missing for Incident Process:

1. **No enabled binding for `contoso_incidentprocess`.** The pane's `resolveContext()` calls
   `getEntityBinding(config, entityName)`; when there's no binding it **rejects the form and keeps the
   previous form's context** (Incident Report). So the chips never change.
2. **The launcher `OnLoad` handler isn't registered on the Incident Process form.** The launcher is
   what writes the current form into the pane's shared context (localStorage) on every navigation. If
   it never runs on the Incident Process form, the pane keeps reading the **stale Incident Report
   context** — so even after you add the binding, the chips still won't advance until the handler is on
   the form.

The prompts themselves are fine: the deployed `agentSidePane.html` already contains the
`contoso_incidentprocess` chips (*Explain this process*, *What's the next step?*, *Escalation
guidance*, *Related policies*). They just never get a chance to render because of the two gaps above.

---

## The fix — two config steps (mirror how Incident Report is already set up)

### Step 1 — Register Incident Process as a bound table
In the **Agent Sidecar Administration** app → open your **"Incident Reports – Sales Knowledge Agent"**
configuration → **Tables & forms** → **add `contoso_incidentprocess` (Incident Process)** with
**Enabled = Yes** → Save / Publish.

*Equivalent (direct data):* add one enabled row to `maftagsc_targetbinding`:
`maftagsc_tablelogicalname = contoso_incidentprocess`, `maftagsc_tabledisplayname = Incident Process`,
`maftagsc_enabled = true`, linked to the same `maftagsc_sidecarconfiguration` record as Incident Report.

### Step 2 — Add the sidecar launcher to the Incident Process main form
In the maker portal → **Tables → Incident Process → Forms → the main form your app uses** →

1. **Form libraries:** add the **same launcher web resource that's already on the Incident Report
   form** (the sidecar launcher JS — in your environment it may be `maftagsc_/copilot/agentSidePane.js`
   or `maftagsc_/copilot/hrAgentSidePane.js`; use whatever the Incident Report form uses).
2. **Events → Form → OnLoad → + Event Handler:** Library = that web resource, **Function =
   `AgentSidecar.initializeGuide`**, **☑ Pass execution context as first parameter**.
3. **Save & Publish.**

> Fastest, foolproof way: open the working **Incident Report** main form side‑by‑side and copy its
> Form library and its OnLoad handler **exactly** onto the Incident Process form. Whatever function
> name it uses (`AgentSidecar.initializeGuide` or the `HRAgentSidecar.initializeGuide` alias — they're
> the same code) is what you should reuse.

### Verify
Open an Incident Process record. Within ~1 second the chips swap to **Explain this process /
What's the next step? / Escalation guidance / Related policies**. Navigate back to an Incident Report
record and they swap back. (The pane polls for form changes every second, so give it a moment.)

### What the config‑only fix (Steps 1–2) does *not* require
- **No** change to the deployed `agentSidePane.*` web resources (the prompts are already bundled).
- **No** Dataverse schema change (the binding table and the `maftagsc_prompts` column already exist).

---

## What we shipped in this update (repo change — pull + redeploy the two web resources)

Two focused, tested runtime improvements. Neither changes the Dataverse schema.

**1. The pane now self‑heals when a bound form is missing the launcher handler.**
Previously the pane always preferred the launcher‑written *shared* context and only read the live host
page when that context was absent — so if a **bound** form lacked the OnLoad handler, the pane kept the
previous form's context (exactly this bug). `resolveContext()` now reconciles the shared context with
the pane's own live read of the host page and **prefers the fresher of the two** whenever they point at
different in‑scope forms. Net effect: **once this update is deployed, Step 2 becomes optional** — the
chips swap on navigation from the pane's live read alone. (Step 1 is still required; see note.)

**2. The launcher caches the sidecar configuration per browser session.**
The launcher's OnLoad handler runs on *every* form and used to re‑read the configuration from Dataverse
each time. It now caches that read in `sessionStorage` for a short TTL (~15 min), collapsing
per‑navigation reads to roughly **one per session**. The pane still reads a fresh configuration when it
(re)loads, so authoring changes surface promptly. This is the answer to "won't 1,000 users hammer
Dataverse?" — with the cache, sidecar navigation is essentially free of per‑nav Dataverse traffic, and
the prompts themselves are bundled in the web resource (zero Dataverse calls, ever).

> **Step 1 is required either way.** A code change cannot invent a binding: if `contoso_incidentprocess`
> has no enabled `maftagsc_targetbinding`, the pane (by design) won't offer help on that form. So add the
> binding (Step 1). After that, Step 2 is optional *with this update* and required *without* it.

**To take the update:** pull the latest `agentSidePane.js` and `agentSidePane.html` web resources
(rebuilt from `model-driven/`) into your solution and publish — same two files you already deploy, no
new components.

---

## App‑agnostic roadmap — your "no reference to any app in the code" ask

You're right on principle: the sidecar **runtime should be app‑agnostic** and read *all* app‑specific
content (which tables it binds to **and** their prompts) from Dataverse — hardcoding neither Marty's HR
tables nor your Contoso incident tables. The design already supports this; two spots currently violate
it:

| Non‑agnostic spot | What it hardcodes | Why it's there |
|---|---|---|
| `hrSidecarBootstrap.ts` | Marty's **HR app** (its app id, entity bindings, agent connection string) as a *fallback* config | Left over from Marty's original HR demo. **Inert for your app** — it's keyed to a different app id, so it never activates for you. |
| `promptCatalog.ts` | A **bundled prompt list keyed by table name** (HR tables **+** `contoso_incidentreport` / `contoso_incidentprocess`) | A deliberate shortcut so chips render without anyone populating Dataverse. This is exactly the "table names baked into the runtime" you're calling out. |

**The agnostic mechanism already exists.** The repository reads prompts generically from
`maftagsc_sidecarconfiguration.maftagsc_prompts` — a JSON blob keyed by table logical name
(`parseAuthoredPrompts` in `sidecarConfigurationRepository.ts`). So the clean end state is: **the code
contains zero business‑table names; Dataverse holds the bindings and the prompts.**

### Sequenced plan (keeps your chips working the whole way if done in order)
1. **Load your prompts into Dataverse** (`maftagsc_prompts` on the sidecar config record) — JSON below.
   Prompts now come from config, not code. *(This also lets you edit prompts without a code deploy.)*
2. **Delete the bundled catalog** (`promptCatalog.ts` + the `applyPromptCatalog` call) and **neutralize
   the bootstrap** (rename `hrSidecarBootstrap.ts` → `sidecarBootstrap.ts`, empty its config, keep the
   repository wiring). Rewrites a few tests that currently assert the HR seed data.
3. **Rebrand the deployment** (optional but needed for *zero* HR mentions): rename the deployed
   `HRAgentSidecar` solution and `hrAgentSidePane.*` web resources to neutral names, point your Incident
   forms' OnLoad at `AgentSidecar.initializeGuide`, drop the `HRAgentSidecar` alias, and redeploy.

**Why I didn't just do this while you were away:** step 1 writes to your Contoso‑Dev Dataverse (needs
your go‑ahead / env access), and steps 2–3 touch your **live** deployment, your Incident **forms**, and
the test suite. I don't want to blank your working chips or break a form handler unattended — that's the
scope question I asked. Give me the go‑ahead (and which scope) and I'll execute it end‑to‑end.

### `maftagsc_prompts` JSON — paste into your sidecar config record
```json
{
  "contoso_incidentreport": [
    { "label": "Summarize this incident", "text": "Summarize this incident report, including the key details, current status, and any actions taken so far." },
    { "label": "Recommend next steps", "text": "Based on this incident, what are the recommended next steps to investigate and resolve it?" },
    { "label": "Find similar incidents", "text": "Find similar past incidents and explain how they were resolved." },
    { "label": "Draft a status update", "text": "Draft a concise status update for stakeholders about this incident." }
  ],
  "contoso_incidentprocess": [
    { "label": "Explain this process", "text": "Explain this incident process and what each stage involves." },
    { "label": "What's the next step?", "text": "Given the current stage of this incident process, what is the next step I should take?" },
    { "label": "Escalation guidance", "text": "What are the escalation criteria and steps for this incident process?" },
    { "label": "Related policies", "text": "What policies or guidelines apply to this incident process?" }
  ]
}
```

> Once these are in Dataverse and verified, the bundled `promptCatalog.ts` becomes redundant and can be
> removed (step 2) with your chips still rendering — sourced from config, fully app‑agnostic.
