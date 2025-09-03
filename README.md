# Enov8 - CMDB Update (GitHub Action)

Dependency-free JavaScript Action to update Enov8 CMDB via **PUT**:
- URL: `${enov8_url}/api/{SystemInstance|SystemComponent|SystemInterface}`
- Headers: `user-id`, `app-id`, `app-key`
- Payload:
  ```json
  {
    "Resource Name": "<name>",
    "Version": "...",  // optional or required if includeVersion=true
    "Status": "..."    // optional or required if includeStatus=true
  }
  ```

## Inputs
- `resourceType` (required) — `Environment Instance` | `System Component` | `System Interface`
- `resourceName` (required)
- `version` (optional; required if `includeVersion=true`)
- `status` (optional; required if `includeStatus=true`)
- `includeVersion` (default `false`)
- `includeStatus` (default `false`)
- `app_id` (required)
- `app_key` (required)
- `enov8_url` (required)
- `insecure_skip_tls_verify` (optional; default `false`)

## Example workflow
```yaml
name: Send Enov8 Update
on:
  workflow_dispatch:

jobs:
  notify-enov8:
    runs-on: ubuntu-latest
    steps:
      - name: Update CMDB in Enov8
        uses: hpashok24/enov8-cmdb-update@v1
        with:
          resourceType: "Environment Instance"
          resourceName: "GDW Dev"
          includeVersion: "true"
          version: "18.0.0"
          includeStatus: "true"
          status: "Deployed"
          app_id:  ${{ secrets.ENOV8_APP_ID }}
          app_key: ${{ secrets.ENOV8_APP_KEY }}
          enov8_url: ${{ secrets.ENOV8_BASE_URL }}
```

## Release
```bash
git init
git add .
git commit -m "initial: enov8 cmdb update action"
git branch -M main
# Create the repo hpashok24/enov8-cmdb-update in GitHub UI or with gh CLI:
# gh repo create hpashok24/enov8-cmdb-update --public --source=. --remote=origin --push
git remote add origin https://github.com/hpashok24/enov8-cmdb-update.git
git push -u origin main
git tag -a v1 -m "v1"
git push --follow-tags
```
