# 🛡️ Enov8 - Governed Deployment Version Update GitHub Action

## 🚀 Overview

This action updates the deployed version for an Environment Instance, System Component, System Interface, or MicroService in Enov8 directly from GitHub Actions. If the target resource does not yet exist, the action can create it, resolving any related System, Environment, or System Instance records by name.

Every change is made **as the GitHub user who ran the workflow**. The action reads that identity from GitHub itself, maps it to an Enov8 user, and checks that user's access before anything is written to the CMDB. There is no user ID to type into the workflow, so a workflow author cannot act as someone else.

## ✨ Key Features

- **Identity from GitHub, not from the workflow** — the user is taken from `GITHUB_TRIGGERING_ACTOR` (falling back to `GITHUB_ACTOR`), which GitHub sets and a workflow cannot overwrite
- **Mapped to an Enov8 user** — the GitHub username must match an Enov8 user's **User ID** (not case-sensitive)
- **User validation** — the Enov8 user must be active (`ActiveUser`) and have Login Access `Yes`
- **System access control** — for Environment Instances and MicroServices, on both create and update, the user must be a member of the associated System's **Assigned To** group
- **Validation before write** — rejected requests make no changes in Enov8
- **System lookup by Resource ID** — the System is found by `Resource ID` (e.g. an APM ID) first, then by name
- **System ↔ System links** — records Upstream and Downstream connections between Systems (not instances), each identified by its Resource ID

- Updates deployed version information for Environment Instances, System Components, System Interfaces, and MicroServices
- Creates a resource automatically when it does not already exist, resolving referenced records by name instead of requiring internal Enov8 IDs
- Cascades creation through dependent records where needed — a MicroService can create its System Instance, which can create its System
- Supports four resource types: Environment Instance, System Component, System Interface, and MicroService
- Populates the System's **Resource ID** (e.g. an APM ID) when a new System is created
- Safe to re-run and safe to run in parallel (for example a build matrix) — a same-version re-run succeeds with a warning, and parallel jobs share any System or System Instance they both need to create
- Exposes outputs (`created`, `resource-id`, `previous-version`, `result`) so later steps can react to what happened
- Works with on-prem Enov8 instances: custom ports, self-hosted runners, and self-signed certificates

## 👤 One-time setup: map GitHub users to Enov8 users

Each person who will run deployments needs an Enov8 user whose **User ID** is the same as their **GitHub username** (for example GitHub `jsmith-dev` → Enov8 User ID `jsmith-dev`). Upper and lower case don't matter.

- Because users are created in Enov8, only Enov8 administrators can decide who is who.
- Runs triggered by bots (for example `dependabot[bot]`) are rejected. Deployments must be triggered by a mapped person.

## 🔐 How validation works

### 1. Identity and user validation (all resource types)

The action reads the GitHub user who triggered the run and looks up the Enov8 user whose **User ID** matches it (`GET /api/User`). The request is rejected if:

- the run was triggered by a bot account,
- no Enov8 user is mapped to that GitHub username, or more than one is,
- the user's **User Status** is not active (for example `InactiveUser`), or
- the user's **Login Access** is not `Yes` (for example awaiting approval)

### 2. System access (Environment Instance and MicroService)

The action first works out which System the request affects:

| Operation | Associated System |
|---|---|
| Update an Environment Instance | The System of that instance |
| Create an Environment Instance | The System in `metadata` (by `Resource ID`, then `System` name) |
| Update or create a MicroService on an existing `systemInstance` | The System of that `systemInstance` |
| Create a MicroService on a new `systemInstance` | The System in `metadata` (by `Resource ID`, then `System` name) |

It then reads the System's **Assigned To** group (`GET /api/System`) and checks the group's **Group Users** (`GET /api/Group`). Access is granted only if the user is listed in that group.

If the System does not exist yet and is being created by the same run, there is no group to check against, so the access check is skipped and this is shown in the log.

System Component and System Interface requests only need the identity and user validation in step 1.

## 🧩 Supported Resource Types

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

## 📥 Required Inputs

| Name | Required | Description |
|---|---|---|
| `enov8_url` | ✅ | Base Enov8 URL, excluding `/api`. Use `https://`; a custom port is supported (`https://host:8443/ecosystem`). `http://` is also accepted for a trusted internal network, but credentials are then sent unencrypted and a warning is logged |
| `app_id` | ✅ | Enov8 App ID credential |
| `app_key` | ✅ | Enov8 App Key credential |
| `resourceType` | ✅ | One of the resource types listed above |
| `resourceName` | ✅ | Exact resource name, matching Enov8 exactly |
| `version` | ✅ | The version value to set |

## 📥 Optional Inputs

| Name | Required | Description |
|---|---|---|
| `systemInstance` | Only for `MicroService` | Name of the parent System Instance |
| `autocreate` | ❌ (default `false`) | When `true`, creates `resourceName` if it does not already exist, using `metadata`. A not-found resource always fails the run unless this is set. |
| `metadata` | Only when `autocreate` is used and the resource is missing | JSON object describing how to create the resource — see [Configuring metadata](#-configuring-metadata) |
| `insecure_skip_tls_verify` | ❌ (default `false`) | When `true`, skips TLS certificate verification. Only for on-prem Enov8 instances with a self-signed certificate — see [Network access](#-network-access-and-self-hosted-runners). A warning is logged whenever it is on. |

## 📤 Outputs

| Output | Description |
|---|---|
| `created` | `true` if this run created `resourceName`, `false` if it updated it or it was already up to date. Records created along the way (a System or System Instance) do not change this — it describes the target resource only. |
| `resource-id` | The Enov8 ID (`ECO-…`) of the target resource. |
| `previous-version` | The Version the resource held before this run — empty if it was just created or had no version. It is read just before the update (one extra read-only request); if that lookup fails the run carries on and this output is empty. |
| `result` | The raw JSON response from the Enov8 API for the target resource. |

Use them in a later step, for example to notify only when something was auto-created:

```yaml
      - name: Enov8 - Deployment Version Update
        id: enov8
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          # ...inputs...

      - name: Announce new onboarding
        if: steps.enov8.outputs.created == 'true'
        run: echo "Onboarded ${{ steps.enov8.outputs.resource-id }} into Enov8"

      - name: Announce an upgrade
        if: steps.enov8.outputs.created == 'false' && steps.enov8.outputs.previous-version != ''
        run: echo "Upgraded from ${{ steps.enov8.outputs.previous-version }} to ${{ github.ref_name }}"
```

## ⚙️ Setup Guide

### Step 1 — Add your Enov8 URL and credentials

Go to your repository:

**Settings → Secrets and variables → Actions**

Add the two credentials as **secrets** (Secrets tab → **New repository secret**):

| Secret Name | Example Value |
|---|---|
| `ENOV8_APP_ID` | `your_app_id` |
| `ENOV8_APP_KEY` | `your_app_key` |

Add the URL as a **variable** (Variables tab → **New repository variable**):

| Variable Name | Example Value |
|---|---|
| `ENOV8_BASE_URL` | `https://yourcompany.enov8.cloud/ecosystem` |

The URL isn't sensitive, so a variable is preferable: GitHub masks secret values as `***` in logs, which makes failed runs harder to debug. A secret named `ENOV8_BASE_URL` also works if you'd rather keep it hidden — just reference it as `${{ secrets.ENOV8_BASE_URL }}`.

## 🔐 Using GitHub Environment Secrets (Recommended)

If your repository uses GitHub Environments, specify the environment in your workflow:

```yaml
environment: dev
```

This ensures GitHub uses the correct environment-specific secrets.

> ⚠️ **Important:** Without specifying the environment, GitHub may use repository-level secrets instead of environment secrets.

### Step 2 — Create Workflow

Create a file:

```bash
.github/workflows/enov8.yml
```

## 💡 Usage Examples

### 🔄 Update an existing resource

```yaml
name: Enov8 CMDB Update

on:
  workflow_dispatch:

jobs:
  update-cmdb:
    runs-on: ubuntu-latest
    environment: dev

    steps:
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
```

### 🔄 Update an existing MicroService

```yaml
name: Enov8 MicroService Update

on:
  workflow_dispatch:

jobs:
  update-microservice:
    runs-on: ubuntu-latest
    environment: dev

    steps:
      - name: Enov8 - MicroService Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "MicroService"
          resourceName: "Web Portal"
          systemInstance: "GDW (DEV)"
          version: "4.1"
```

### 🆕 Create the resource if it does not exist

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (DEV)"
          version: "18.0.12"
          autocreate: true
          metadata: |
            {
              "System": "GDW",
              "Environment": "DEV Env"
            }
```

### 🆕 Create the resource and its System, if the System also does not exist

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "NewSystem (DEV)"
          version: "1.0.0"
          autocreate: true
          metadata: |
            {
              "System": "NewSystem",
              "Environment": "DEV Env",
              "Business Unit": "IT",
              "Type": "Cloud",
              "Core": "True",
              "Resource ID": "APM-12345"
            }
```

`Business Unit`, `Type`, `Core`, and `Resource ID` are only used if `System` needs to be created, and are ignored otherwise.

### 🧩 MicroService, cascading through System Instance and System

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "MicroService"
          resourceName: "Web Portal"
          systemInstance: "GDW (DEV)"
          version: "4.1"
          autocreate: true
          metadata: |
            {
              "System": "GDW",
              "Environment": "DEV Env",
              "Business Unit": "IT",
              "Type": "Cloud",
              "Core": "True",
              "Resource ID": "APM-12345"
            }
```

If `systemInstance` already exists, `metadata` can be `{}` — nothing below the MicroService needs creating.

### 🆕 System Component

```yaml
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "System Component"
          resourceName: "AppServer_PROD_NewApp"
          version: "1.0"
          autocreate: true
          metadata: |
            {
              "Type": "Server",
              "Monitored": "True"
            }
```

System Component has no System or Environment dependency. Unlike other resource types, `Type` has no default here and must be supplied.

### 🚀 Record a version after a real deployment

The examples above use `workflow_dispatch` with a hardcoded version. In practice, run the action after your deploy job and pass the version you actually deployed:

```yaml
name: Deploy and record in Enov8

on:
  push:
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ./deploy.sh   # your deployment

  record-in-enov8:
    needs: deploy          # only record a version that actually deployed
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - name: Enov8 - Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ vars.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "GDW (PROD)"
          version: ${{ github.ref_name }}
          autocreate: true
          metadata: |
            {
              "System": "GDW",
              "Environment": "PROD Env"
            }
```

`github.ref_name` is the tag that triggered the run (for example `v1.4.2`, including the `v`). To record a version your build produced instead, pass it from the build job with `${{ needs.build.outputs.version }}`.

### 🔗 Create the resource and its System, with Upstream and Downstream links

```yaml
      - name: Enov8 - Governed Deployment Version Update
        uses: enov8-Ltd/enov8-update-deployment-version@v1
        with:
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
          app_id: ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          resourceType: "Environment Instance"
          resourceName: "NewSystem (DEV)"
          version: "1.0.0"
          autocreate: true
          metadata: |
            {
              "System": "NewSystem",
              "Environment": "DEV Env",
              "Business Unit": "IT",
              "Type": "Cloud",
              "Core": "True",
              "Resource ID": "APM-12345",
              "Upstream": [
                { "Resource ID": "APM-1001", "ConnectionTechnology": "ESB" }
              ],
              "Downstream": [
                { "Resource ID": "APM-2002", "ConnectionTechnology": "ESB" },
                { "Resource ID": "APM-3003", "ConnectionTechnology": "FTP" }
              ]
            }
```

The action creates `NewSystem` (with Resource ID `APM-12345`) and the instance `NewSystem (DEV)`, then links `NewSystem` to the Systems whose Resource IDs are listed. 

| Entry | SOURCE_ID | TARGET_ID | Connection Type |
|---|---|---|---|
| Upstream `APM-1001` | NewSystem | System with Resource ID `APM-1001` | ESB |
| Downstream `APM-2002` | System with Resource ID `APM-2002` | NewSystem | ESB |
| Downstream `APM-3003` | System with Resource ID `APM-3003` | NewSystem | FTP |

The same `Upstream` / `Downstream` lists also work when the System already exists, and on a plain version update: the links are added to the instance's System, and links that already exist are skipped.

### Step 3 — Run Workflow

1. Go to the **Actions** tab
2. Select your workflow
3. Click **Run workflow**

## 🔍 Example Output

```text
🔐 GitHub user "jsmith-dev" — looking up the mapped Enov8 user (User ID)
✅ GitHub user "jsmith-dev" → Enov8 user "jsmith-dev" (User Status: ActiveUser)
🔐 Checking access of "jsmith-dev" to System "GDW" (Assigned To: Enterprise IT)
✅ User "jsmith-dev" is a member of "Enterprise IT" — access granted to System "GDW"
ℹ️ Current version in Enov8: 18.0.11
📡 PUT https://.../api/SystemInstance
📦 Payload ...
📨 Response ...
✅ Enov8 CMDB updated successfully
```

## ⚠️ Important Notes

**✅ Correct URL format**

```text
https://<your-enov8-instance>/ecosystem
```

**❌ Do NOT include**

```text
/api
```

## ⚠️ Resource Name Must Match Exactly

```text
GDW (DEV)   ✅
gdw dev     ❌
```

Leading and trailing whitespace in inputs and in `metadata` values is trimmed automatically.

## 📌 Behaviour Notes

**Re-running a workflow.** The action always tries to update first. If the version you send is already what Enov8 holds, Enov8 reports nothing to change and the step **succeeds** with a `⚠️ No update applied` warning (`created` is `false`). A re-run never fails because of this.

**Duplicate names.** Resource names are unique in Enov8, so `resourceName` identifies exactly one record, and creating a second record with the same name is rejected. The exception is MicroServices: the same MicroService name can exist under different System Instances. That is why `systemInstance` is required — an update only touches the MicroService under that instance.

**Parallel jobs (for example a build matrix).** Several jobs can safely need the same missing System or System Instance at the same time: one creates it and the others detect that and reuse it. Give each job its own `resourceName` — if two jobs try to create the *same* resource at once, one of them fails with Enov8's duplicate-name error.

## 🌐 Network access and self-hosted runners

The action calls the Enov8 API over HTTPS from the machine running the job.

- **Enov8 Cloud or any publicly reachable instance:** GitHub-hosted runners (`ubuntu-latest`) work, as in the examples above.
- **On-prem, behind a firewall or VPN:** GitHub-hosted runners can't reach it. Run the job on a [self-hosted runner](https://docs.github.com/actions/hosting-your-own-runners) that can, by changing `runs-on: ubuntu-latest` to your runner's labels (for example `runs-on: [self-hosted, linux]`).
- **Custom port:** include it in the URL, for example `https://enov8.internal.example.com:8443/ecosystem`.
- **Self-signed or internal-CA certificate:** the preferred fix is to trust that CA on the runner. If that isn't possible, set `insecure_skip_tls_verify: true`. This disables certificate verification for the whole run and logs a warning, so use it only for on-prem instances you control.
- **Plain `http://`:** accepted for a trusted internal network only. The App ID and App Key travel unencrypted, so the action logs a warning every time. Prefer `https://` wherever you can.

## 🔧 Configuring `metadata`

`metadata` is used to create `resourceName` when `autocreate` is `true` and it does not already exist. It is also read on every run for the access check (`System` / `Resource ID`) and for System links (`Upstream` / `Downstream`). Its shape depends on `resourceType`.

### `Environment Instance`, `System Interface`, `MicroService`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | Applied to every record created in one run. |
| `Environment` | — (required if needed) | Resolved by name. Not created automatically — the named Environment must already exist. |
| `System` | — (omit if not needed) | Resolved by name if no System matches `Resource ID`. Created automatically if it does not exist. |
| `Business Unit` | `Other` | Used only if `System` is being created. |
| `Type` | `Other` | The System's Type. Used only if `System` is being created. Must match a value already configured in the tenant's System Type picklist. |
| `Core` | `False` | Used only if `System` is being created. Accepts `true`/`false` as a JSON boolean or a string, in any case. |
| `Resource ID` | — (optional) | Your APM ID. The System is looked up by this **first**, then by `System` name. Saved to the System's **Resource ID** field when a new System is created; an existing System's Resource ID is never changed. |

For `MicroService`, the same rules apply one level down: `systemInstance` is resolved first, and if it does not exist, it is created using `Environment`/`System`/`Business Unit`/`Type`/`Core`/`Resource ID` from `metadata`.

`Assigned To` and `Organisation` are always resolved automatically and should not be included in `metadata`.

### System links: `Upstream` and `Downstream`

These keys link **Systems to Systems** (stored in `System_REL_System`). They never link instances or MicroServices.

The System being linked is the System of the request: the `System` / `Resource ID` in `metadata` when it is created, or the System of the instance (or of the MicroService's `systemInstance`) when it already exists. That is why the keys can be sent with `resourceType` `Environment Instance` or `MicroService`, the request types that belong to a System. They are read on **both create and update**.

Each entry in the lists names the **other System** by its Resource ID:

| Key | Required | Notes |
|---|---|---|
| `Resource ID` | ✅ | Resource ID (e.g. APM ID) of the other System. Looked up with `GET /api/System`; it must already exist. |
| `ConnectionTechnology` | ✅ | Sent as the link's `Connection Type`. Must be a value configured in Enov8 (e.g. `ESB`, `FTP`, `WebService`, `BatchService`). |

How links are handled:

- Every entry is checked, and every Resource ID resolved, **before** anything is written. A missing `Resource ID` or `ConnectionTechnology`, or a Resource ID that doesn't exist, rejects the whole request.
- Links are created after the version update or create. If Enov8 rejects a `Connection Type`, the run fails at that link; the log shows which links were already created.
- A link that already exists (same SOURCE and TARGET) is skipped and left unchanged.
- A System cannot be linked to itself.
- Access is checked for this System only (its Assigned To group), not for the linked Systems.

### `System Component`

| Key | Default | Notes |
|---|---|---|
| `Status` | `InOperation` | |
| `Type` | Required, no default | A tenant-specific Component Type picklist, separate from System's Type. Check existing components for valid values (for example `Server`, `Database`, `Module`, `Integration`). |
| `Monitored` | `False` | Accepts `true`/`false` as a JSON boolean or a string, in any case. |

## 🐛 Troubleshooting

**❌ GitHub user "…" is not mapped to any Enov8 user**

- There is no Enov8 user whose **User ID** equals your GitHub username (shown in the log). Ask an Enov8 administrator to create one, or to use your GitHub username as your User ID

**❌ This run was triggered by a bot account**

- Governed updates must be started by a person. Trigger the workflow manually, or from a push or merge by a mapped user

**❌ Enov8 user "…" is not active / does not have login access**

- The user's **User Status** must be active (`ActiveUser`) and **Login Access** must be `Yes`
- Ask an Enov8 administrator to activate the user or approve their access (Configuration → Add Data → Access Management)

**❌ User "…" does not have access to System "…"**

- Open the System in Enov8 and check its **Assigned To** group
- Ask an administrator to add the user to that group's **Group Users**, or use a user who is already a member

**❌ Could not find the System linked to System Instance "…"**

- The instance exists but is not linked to a System, so access cannot be checked. Link the instance to its System in Enov8

**❌ Upstream / Downstream link rejected**

- `"Resource ID" is required` or `"ConnectionTechnology" is required`: every entry needs both keys
- `no System found with Resource ID "…"`: check the linked System's Resource ID in Enov8
- `Failed to link …`: Enov8 rejected the link, most often because the Connection Type isn't a configured value
- `only supported for Environment Instance and MicroService`: links can't be sent with System Component or System Interface

**⚠️ "No update applied" warning**

- Not an error — the step still succeeds. The version you sent is already what Enov8 holds (see [Behaviour Notes](#-behaviour-notes))
- If you expected a change, verify the resource name spelling and that you are targeting the right Enov8 instance

**❌ Create failed / could not resolve a name in `metadata`**

- Verify `autocreate` is set to `true` — without it, a not-found resource is always an error
- Verify the `System` or `Environment` name in `metadata` matches exactly (these are looked up by name against Enov8)
- If `System` also needs creating and you overrode `Business Unit`, verify it matches an existing Business Unit name
- Do not include `Assigned To` or `Organisation` in `metadata` — both are resolved automatically

**❌ Resource ID not set on the System**

- `Resource ID` is only applied when the action **creates** a new System. If the System already exists, its Resource ID is left unchanged — update it in Enov8 directly
- `Resource ID` applies to the System only — it is not set on Environment Instances, System Interfaces, MicroServices, System Instances, or System Components

**❌ System Component create failed — "metadata.Type is required"**

- `System Component` has no default `Type` — you must supply one in `metadata` (e.g. `{"Type": "Server"}`)
- The value must match an existing Component Type in your tenant — this is a different picklist from System's `Type`

**❌ `metadata.Core must be true or false` (or `metadata.Monitored …`)**

- Use `true` or `false` — as a JSON boolean or a string, in any case. Anything else is rejected before any record is created

**❌ "Duplicate value not allowed at Resource Name"**

- A record with that name already exists. If two parallel jobs use the same `resourceName`, one of them fails with this — give each job its own `resourceName`

**❌ Authentication failed**

- Verify `ENOV8_APP_ID`
- Verify `ENOV8_APP_KEY`
- Verify `ENOV8_BASE_URL`

**❌ Certificate error (`self-signed certificate`, `unable to verify the first certificate`)**

- Your Enov8 instance uses a certificate the runner doesn't trust. Install the issuing CA on the runner, or — for an on-prem instance you control — set `insecure_skip_tls_verify: true`

**❌ Connection error (`ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`)**

- The runner can't reach Enov8. For on-prem or firewalled instances use a self-hosted runner (see [Network access](#-network-access-and-self-hosted-runners))
- Check the URL: it must start with `https://` (or `http://` on a trusted internal network), may include a port, and must not include `/api`

**❌ Invalid resource type**

Supported values:

- `Environment Instance`
- `System Component`
- `System Interface`
- `MicroService`

**❌ MicroService update failed**

Ensure `systemInstance` is provided:

```yaml
systemInstance: "GDW (DEV)"
```

## 🔒 Security notes

This action makes sure the **person who ran the workflow** has access in Enov8. To keep that guarantee, also protect the Enov8 credentials themselves, since anyone who can read `ENOV8_APP_KEY` could call the Enov8 API directly:

- Store the secrets in a GitHub **Environment** and add **required reviewers** or **deployment branch rules** to it
- Restrict who can push to the branches that are allowed to deploy
- Secrets are not passed to workflows triggered from forks

## 🚀 Common Use Cases

- CI/CD deployment tracking
- Automated version management
- DevOps CMDB integration
- MicroService deployment tracking
- Auto-provisioning environment instances on first deploy

## 📩 Support
For assistance, contact support@enov8.com.

## 📄 License

[MIT](LICENSE)
