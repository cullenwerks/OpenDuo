# OpenDuo

Open Source GitLab Duo Agentic Chat for Enterprise environments.
PAT-authenticated, no OAuth required, Windows x64.

## Prerequisites

- VS Code 1.85+
- GitLab EE with `access_rest_chat` feature flag enabled
- GitLab Personal Access Token with scopes: `api`, `read_user`, `ai_features`

## Installation

1. Download `openduo-windows-x64-{version}.vsix` from [Releases](../../releases)
2. In VS Code: `Ctrl+Shift+P` → "Extensions: Install from VSIX..."
3. Select the downloaded `.vsix` file
4. Reload VS Code when prompted

## Configuration

1. Open VS Code Settings (`Ctrl+,`)
2. Search for `openduo`
3. Set `openduo.gitlabUrl` to your GitLab instance URL
   Example: `https://gitlab.example.com`
4. Run `Ctrl+Shift+P` → "OpenDuo: Configure PAT"
5. Enter your GitLab PAT (stored securely in Windows Credential Manager)

## Usage

- `Ctrl+Shift+P` → "OpenDuo: Open Chat"
- Ask anything about your GitLab projects:
  - "List my open merge requests in project group/myrepo"
  - "Show me the last 5 failed pipelines"
  - "Create an issue titled 'Fix login bug' in group/frontend"

## Security

- PAT stored in VS Code SecretStorage (Windows DPAPI)
- All traffic via TLS 1.2+ using Windows SChannel (FIPS 140-2 validated)
- Zero telemetry — no data leaves your GitLab instance
- All tool invocations logged to VS Code Output Channel → "OpenDuo"
