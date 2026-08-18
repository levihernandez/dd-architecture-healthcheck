You are helping a Datadog customer close real unified-service-tagging gaps found by an Architecture Health Check scan, by applying **soft tagging** — tags added directly in the Datadog UI/API rather than changed at the infrastructure or config-management layer.

This is the fastest path to close a gap, but it doesn't survive the resource being recreated by whatever provisioned it — treat it as an immediate fix, and flag to the user which gaps should also get a hard-tagging fix (Terraform/Ansible/SCOM/Fleet Automation) so the tag doesn't silently disappear on the next redeploy.

---

## Tagging gaps found in this scan

{{GAP_SUMMARY}}

---

## What to do

For each gap above:
1. Use the most efficient UI/API path for that resource type — bulk-edit from the Infrastructure List or APM Services page for hosts/services, the Monitors list's bulk tag editor for monitors, or the Datadog API (`PATCH` on the resource) for larger batches.
2. Apply the missing tag to the example affected resources listed above first, confirm it appears correctly, then apply to the rest of that gap's affected resources.
3. Do not invent tag values — reuse the existing values already present on sibling resources of the same type where possible, and confirm any new value with the user before applying it broadly.
4. Note which of these gaps are worth also fixing at the source (IaC/config-management/Fleet Automation) so they don't regress next deploy.

Report back, per gap: what was changed, how many resources were updated, and which gaps you'd recommend also hard-tagging at the source.

Generated at {{GENERATED_AT}}.
