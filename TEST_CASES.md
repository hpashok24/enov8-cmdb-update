# Enov8 CMDB Update Action — Test Cases

Target: `hpashok24/enov8-cmdb-update` (GitHub Action)
Scope: `resourceType`, `resourceName`, `version`, `systemInstance`, `autocreate`, `metadata` inputs

---

## 1. Plain Update Path (`autocreate` not set / `false`)

| ID | Title | Preconditions | Inputs | Expected Result |
|----|-------|---------------|--------|------------------|
| U-1 | Update version on existing resource | `resourceName` exists in Enov8 | `resourceType`, `resourceName`, `version` (new value) | Run succeeds (exit 0). Log shows `✅ Enov8 CMDB updated successfully`. Version updated in Enov8. |
| U-2 | Update with unchanged version | `resourceName` exists, already at target version | Same `version` as current | Run succeeds (exit 0). Log shows `⚠️ No update applied (already up-to-date or invalid field)`. No error. |
| U-3 | Update with no `version` supplied | `resourceName` exists | Omit `version` | Run succeeds — no version change requested/made. |
| U-4 | Update non-existent resource, `autocreate` omitted | `resourceName` does NOT exist | `autocreate` not set | Run **fails** (exit 1). Log shows `❌ API Error: ...`. Nothing created. |
| U-5 | Update non-existent resource, `autocreate: false` | `resourceName` does NOT exist | `autocreate: false`, `metadata` supplied anyway | Run **fails** (exit 1) — `metadata` is ignored entirely; no create attempted even though supplied. |

---

## 2. Create Path (`autocreate: true`)

| ID | Title | Preconditions | Inputs | Expected Result |
|----|-------|---------------|--------|------------------|
| C-1 | Create with no `metadata` | `resourceName` does NOT exist | `autocreate: true`, no `metadata` | Run **fails** (exit 1) — `metadata is required to create ... when autocreate is true`. |
| C-2 | Create with minimal `metadata` (System + Environment exist already) | `resourceName` doesn't exist; referenced `System`/`Environment` DO exist | `autocreate: true`, `metadata: {"System": "<existing>", "Environment": "<existing>"}` | Resource created (`total_created: 1`). `Status` auto-set to `InOperation`. `Assigned To`/`Organisation` auto-resolved, never supplied. |
| C-3 | Create with unknown `Environment` name | `Environment` name in `metadata` does not exist in Enov8 | `autocreate: true`, bad `Environment` value | Run **fails** — `Could not resolve "<name>" via Environment lookup`. |
| C-4 | Create with explicit `Status` override | — | `metadata.Status: "PlannedOutage"` (or any valid tenant status) | Created resource has that Status, not the `InOperation` default. |
| C-5 | Re-run C-2 a second time with the same `resourceName` | Resource now exists from C-2 | Same inputs as C-2 | Falls through to the **update** path instead (matches U-1/U-2 behavior) — does not attempt to create again. |

---

## 3. System Cascade-Create

| ID | Title | Preconditions | Inputs | Expected Result |
|----|-------|---------------|--------|------------------|
| S-1 | System referenced in `metadata` doesn't exist, no overrides | Neither `resourceName` nor `System` exist | `autocreate: true`, `metadata: {"System": "<new>", "Environment": "<existing>"}` | System created first (`Business Unit: "Other"`, `Type: "Other"`, `Core: "False"` — all defaults), then the target resource created referencing it. Two `POST` calls logged. |
| S-2 | System cascade with explicit `Business Unit` | System doesn't exist | `metadata["Business Unit"]: "IT"` (or other real Business Unit name) | System created with that Business Unit, not `"Other"`. |
| S-3 | System cascade with explicit `Type` | System doesn't exist | `metadata.Type: "Cloud"` (must be a value configured in the target tenant) | System created with `Type: "Cloud"`. |
| S-4 | System cascade with invalid `Type` | System doesn't exist | `metadata.Type: "<value not configured in tenant>"` | System creation **fails** — Enov8 returns `[OBJ_ERROR] [TYPE - Invalid System ID: <value>]`. Action exits 1. Nothing created. |
| S-5 | System cascade with unknown `Business Unit` name | — | `metadata["Business Unit"]: "<nonexistent>"` | Run **fails** — `Could not resolve "<name>" via BusinessUnit lookup`. |
| S-6 | `System` already exists | System exists, only the instance doesn't | `metadata: {"System": "<existing>", ...}` | No System creation attempted — existing System's ID is resolved and reused directly. Only one `POST` (for the instance) is logged. |

---

## 4. `autocreate` Value Parsing

| ID | Title | Inputs | Expected Result |
|----|-------|--------|------------------|
| A-1 | `autocreate: true` (unquoted boolean in YAML) | — | Treated as true — create path enabled. |
| A-2 | `autocreate: "true"` (quoted string) | — | Treated as true — same as A-1. |
| A-3 | `autocreate: "True"` / `"TRUE"` (mixed case) | — | Treated as true — case-insensitive match. |
| A-4 | `autocreate: false` / omitted | — | Treated as false — update-only behavior (see U-4). |
| A-5 | `autocreate: "yes"` / `"1"` / other truthy-looking string | — | Treated as **false** — only the literal string `true` (any case) is truthy; document this if it surprises testers. |

---

## 5. Input Validation

| ID | Title | Inputs | Expected Result |
|----|-------|--------|------------------|
| V-1 | Missing required input (`enov8_url`, `resourceName`, `resourceType`, `app_id`, or `app_key`) | Omit any one | Run fails immediately — `Missing input: <name>`. |
| V-2 | Invalid `resourceType` | `resourceType: "Bogus Type"` | Run **fails** — `Invalid resourceType: Bogus Type`. No API call made. |
| V-3 | `enov8_url` with trailing slash(es) | `enov8_url: "https://.../ecosystem/"` | Trailing slash(es) stripped automatically; API calls still resolve correctly. |

---

## Notes for Testers

- Always use a `resourceName` (and `System`, if testing cascade-create) that is **known not to exist** when testing create-path cases — re-running with the same name will just exercise the update path instead.
- `Type` values are tenant-specific (configured in Enov8 admin) — confirm the valid list for your test tenant before running S-3/S-4.
- No test case here should ever require supplying `Assigned To` or `Organisation` — if a tester finds a scenario where those are needed as input, that's a regression.
- `Status` is only relevant to the create path; it's never sent/read on plain updates.
