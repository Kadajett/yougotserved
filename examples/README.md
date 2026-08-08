# Adapter coverage

These adapters use the connected real Chrome session through `scripts/run-adapter.mjs`.
Generic YGS browser tools are for live selector discovery; normal runs use the
compact adapter tools.

| Adapter    | Live verification                                              | Submission evidence                                                        |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ashby      | Form inspection and application controls                       | Headway and Protege submitted                                              |
| Greenhouse | Inspection, application, and email-code verification           | Temporal submitted                                                         |
| Lever      | Inspection, application, and `/thanks` confirmation            | Zuma submitted                                                             |
| Rippling   | 19 standard/custom fields and option lists                     | Not submitted; fixture was junior                                          |
| Workable   | Standard controls and four custom questions                    | Not submitted; fixture was junior                                          |
| Workday    | Entry, eight-step progress, and tenant account gate            | Post-account selectors unverified; no GM account or draft created          |
| Gmail      | Thread search, full-thread reads, and general auth-code search | Found the live Temporal code and all four confirmation threads             |
| LinkedIn   | People search, connection degree, and profile reads            | Read-only enrichment; no first-degree contacts found for today's companies |

Custom company-hosted application flows are intentionally outside this reusable
adapter set. Workday should be re-inspected after account creation on the first
genuinely suitable role before trusting its post-account submit path.

All adapters are typechecked together:

```bash
npx tsc -p examples/tsconfig.json
```
