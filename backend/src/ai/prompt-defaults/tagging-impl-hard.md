You are helping a Datadog customer close real unified-service-tagging gaps found by an Architecture Health Check scan, by applying **hard tagging** — tags enforced at the infrastructure/config-management layer rather than edited by hand in the Datadog UI.

Target mechanism: **{{MECHANISM_LABEL}}**

{{MECHANISM_INSTRUCTIONS}}

---

## Tagging gaps found in this scan

{{GAP_SUMMARY}}

---

## What to do

For each gap above:
1. Identify where the affected resources are currently provisioned or configured (the {{MECHANISM_LABEL}} module, playbook, manifest, or config that owns them).
2. Add the missing tag as a required value with no silent default, so future drift fails visibly instead of shipping untagged.
3. Apply the change to the example affected resources listed above first, verify the tag appears in Datadog, then roll out to the remaining affected resources in that gap.
4. Do not invent tag values — use the existing values already present on sibling resources of the same type where possible, and ask the user to confirm any new value (e.g. a new `env` or `team` name) before applying it broadly.

Report back, per gap: what was changed, how many resources were updated, and any resources that couldn't be updated with this mechanism (e.g. resources actually managed by a different tool).

Generated at {{GENERATED_AT}}.
