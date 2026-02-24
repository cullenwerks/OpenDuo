# OpenDuo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Build OpenDuo — a VS Code extension with an embedded Rust backend providing PAT-authenticated GitLab Duo Agentic Chat for Federal (DOJ/DoD) environments.

**Architecture:** A TypeScript/React VS Code extension spawns `openduo-server.exe` (Axum HTTP server) as a child process on activation. The extension proxies chat messages to the server via localhost HTTP, which runs a ReAct agent loop against the GitLab AI Gateway, executing GitLab REST API tools between model turns and streaming token responses back to the webview via SSE.

**Tech Stack:** Rust (`axum`, `tokio`, `reqwest`+`native-tls`, `serde_json`, `schemars`, `tracing`), TypeScript (VS Code Extension API, SecretStorage), React (`esbuild`, `vitest`), GitLab AI Gateway (`POST /api/v4/chat/completions`), `vsce` for `.vsix` packaging.

---

## Phase 1 — Foundation

### Task 1: Rust Workspace Scaffold

**Files:**
- Create: `Cargo.toml` (workspace root)
- Create: `crates/openduo-core/Cargo.toml`
- Create: `crates/openduo-agent/Cargo.toml`
- Create: `crates/openduo-tools/Cargo.toml`
- Create: `crates/openduo-server/Cargo.toml`
- Create: `crates/openduo-core/src/lib.rs`
- Create: `crates/openduo-agent/src/lib.rs`
- Create: `crates/openduo-tools/src/lib.rs`
- Create: `crates/openduo-server/src/main.rs`

**Step 1: Create workspace Cargo.toml**

```toml
# Cargo.toml
[workspace]
members = [
    "crates/openduo-core",
    "crates/openduo-agent",
    "crates/openduo-tools",
    "crates/openduo-server",
]
resolver = "2"

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
axum = { version = "0.7", features = ["macros"] }
reqwest = { version = "0.12", default-features = false, features = ["native-tls", "json", "stream"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
schemars = { version = "0.8", features = ["derive"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
thiserror = "1"
anyhow = "1"
async-trait = "0.1"
futures = "0.3"
tokio-stream = "0.1"
```

**Step 2: Create each crate's Cargo.toml**

```toml
# crates/openduo-core/Cargo.toml
[package]
name = "openduo-core"
version = "0.1.0"
edition = "2021"

[dependencies]
reqwest = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
tokio = { workspace = true }
```

```toml
# crates/openduo-agent/Cargo.toml
[package]
name = "openduo-agent"
version = "0.1.0"
edition = "2021"

[dependencies]
openduo-core = { path = "../openduo-core" }
openduo-tools = { path = "../openduo-tools" }
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
async-trait = { workspace = true }
tokio = { workspace = true }
futures = { workspace = true }
tokio-stream = { workspace = true }
```

```toml
# crates/openduo-tools/Cargo.toml
[package]
name = "openduo-tools"
version = "0.1.0"
edition = "2021"

[dependencies]
openduo-core = { path = "../openduo-core" }
serde = { workspace = true }
serde_json = { workspace = true }
schemars = { workspace = true }
tracing = { workspace = true }
thiserror = { workspace = true }
anyhow = { workspace = true }
async-trait = { workspace = true }
tokio = { workspace = true }
```

```toml
# crates/openduo-server/Cargo.toml
[package]
name = "openduo-server"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "openduo-server"
path = "src/main.rs"

[dependencies]
openduo-core = { path = "../openduo-core" }
openduo-agent = { path = "../openduo-agent" }
openduo-tools = { path = "../openduo-tools" }
axum = { workspace = true }
tokio = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
anyhow = { workspace = true }
futures = { workspace = true }
tokio-stream = { workspace = true }
```

**Step 3: Create stub lib.rs files**

```rust
// crates/openduo-core/src/lib.rs
pub mod auth;
pub mod config;
pub mod gitlab_client;
```

```rust
// crates/openduo-agent/src/lib.rs
pub mod provider;
pub mod prompt;
pub mod react_loop;
```

```rust
// crates/openduo-tools/src/lib.rs
pub mod registry;
pub mod issues;
pub mod merge_requests;
pub mod pipelines;
pub mod repositories;
pub mod projects;
pub mod users;
pub mod cicd;
pub mod milestones;
pub mod labels;
```

```rust
// crates/openduo-server/src/main.rs
fn main() {
    println!("openduo-server stub");
}
```

**Step 4: Verify workspace compiles**

```bash
cd /c/Users/Culle/OneDrive/Desktop/git2/gitlab/openduo
cargo build 2>&1
```
Expected: warnings only, no errors.

**Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/
git commit -m "chore: scaffold Rust workspace with 4 crates"
```

---

### Task 2: openduo-core — Config

**Files:**
- Create: `crates/openduo-core/src/config.rs`
- Create: `crates/openduo-core/tests/config_test.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-core/tests/config_test.rs
use openduo_core::config::Config;

#[test]
fn test_config_from_env() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test123");
    let cfg = Config::from_env().unwrap();
    assert_eq!(cfg.gitlab_url, "https://gitlab.example.com");
    assert_eq!(cfg.pat, "glpat-test123");
}

#[test]
fn test_config_missing_env_fails() {
    std::env::remove_var("GITLAB_URL");
    std::env::remove_var("GITLAB_PAT");
    let result = Config::from_env();
    assert!(result.is_err());
}
```

**Step 2: Run to verify failure**

```bash
cargo test -p openduo-core 2>&1
```
Expected: FAIL — `config` module not found.

**Step 3: Implement Config**

```rust
// crates/openduo-core/src/config.rs
use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub gitlab_url: String,
    pub pat: String,
    pub server_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let gitlab_url = std::env::var("GITLAB_URL")
            .map_err(|_| anyhow!("GITLAB_URL environment variable not set"))?;
        let pat = std::env::var("GITLAB_PAT")
            .map_err(|_| anyhow!("GITLAB_PAT environment variable not set"))?;
        let server_port = std::env::var("OPENDUO_PORT")
            .unwrap_or_else(|_| "8745".to_string())
            .parse::<u16>()
            .map_err(|_| anyhow!("OPENDUO_PORT must be a valid port number"))?;
        Ok(Self { gitlab_url, pat, server_port })
    }
}
```

**Step 4: Run tests to verify pass**

```bash
cargo test -p openduo-core config 2>&1
```
Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add crates/openduo-core/
git commit -m "feat(core): add Config with from_env() and validation"
```

---

### Task 3: openduo-core — PAT Auth

**Files:**
- Create: `crates/openduo-core/src/auth.rs`
- Modify: `crates/openduo-core/tests/config_test.rs` (add auth tests)

**Step 1: Write failing test**

```rust
// Add to crates/openduo-core/tests/config_test.rs
use openduo_core::auth::AuthHeaders;

#[test]
fn test_auth_headers_contain_pat() {
    let headers = AuthHeaders::new("glpat-abc123");
    let map = headers.to_header_map().unwrap();
    assert_eq!(
        map.get("PRIVATE-TOKEN").unwrap(),
        "glpat-abc123"
    );
}

#[test]
fn test_auth_headers_contain_content_type() {
    let headers = AuthHeaders::new("glpat-abc123");
    let map = headers.to_header_map().unwrap();
    assert!(map.contains_key("Content-Type"));
}
```

**Step 2: Run to verify failure**

```bash
cargo test -p openduo-core auth 2>&1
```
Expected: FAIL — `auth` module not found.

**Step 3: Implement AuthHeaders**

```rust
// crates/openduo-core/src/auth.rs
use anyhow::Result;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

pub struct AuthHeaders {
    pat: String,
}

impl AuthHeaders {
    pub fn new(pat: impl Into<String>) -> Self {
        Self { pat: pat.into() }
    }

    pub fn to_header_map(&self) -> Result<HeaderMap> {
        let mut map = HeaderMap::new();
        map.insert(
            HeaderName::from_static("private-token"),
            HeaderValue::from_str(&self.pat)?,
        );
        map.insert(
            reqwest::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        Ok(map)
    }
}
```

**Step 4: Run tests**

```bash
cargo test -p openduo-core 2>&1
```
Expected: all pass.

**Step 5: Commit**

```bash
git add crates/openduo-core/src/auth.rs crates/openduo-core/tests/
git commit -m "feat(core): add PAT AuthHeaders with PRIVATE-TOKEN injection"
```

---

### Task 4: openduo-core — GitLab REST Client

**Files:**
- Create: `crates/openduo-core/src/gitlab_client.rs`
- Create: `crates/openduo-core/tests/gitlab_client_test.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-core/tests/gitlab_client_test.rs
use openduo_core::config::Config;
use openduo_core::gitlab_client::GitLabClient;

#[tokio::test]
async fn test_client_builds_without_panicking() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    let config = Config::from_env().unwrap();
    let client = GitLabClient::new(config);
    assert!(client.base_url().starts_with("https://"));
}
```

**Step 2: Run to verify failure**

```bash
cargo test -p openduo-core gitlab_client 2>&1
```
Expected: FAIL.

**Step 3: Implement GitLabClient**

```rust
// crates/openduo-core/src/gitlab_client.rs
use crate::auth::AuthHeaders;
use crate::config::Config;
use anyhow::Result;
use reqwest::Client;
use serde::de::DeserializeOwned;
use tracing::instrument;

#[derive(Clone)]
pub struct GitLabClient {
    client: Client,
    base_url: String,
    pat: String,
}

impl GitLabClient {
    pub fn new(config: Config) -> Self {
        let client = Client::builder()
            .use_native_tls()
            .build()
            .expect("Failed to build reqwest client");
        Self {
            client,
            base_url: config.gitlab_url.trim_end_matches('/').to_string(),
            pat: config.pat,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn api_url(&self, path: &str) -> String {
        format!("{}/api/v4/{}", self.base_url, path.trim_start_matches('/'))
    }

    #[instrument(skip(self))]
    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self.client
            .get(self.api_url(path))
            .headers(headers)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    #[instrument(skip(self, body))]
    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: serde_json::Value) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self.client
            .post(self.api_url(path))
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    #[instrument(skip(self, body))]
    pub async fn put<T: DeserializeOwned>(&self, path: &str, body: serde_json::Value) -> Result<T> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let resp = self.client
            .put(self.api_url(path))
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(resp.json::<T>().await?)
    }

    pub async fn get_raw(&self, url: &str) -> Result<reqwest::Response> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        Ok(self.client.get(url).headers(headers).send().await?.error_for_status()?)
    }

    pub async fn post_stream(&self, url: &str, body: serde_json::Value) -> Result<reqwest::Response> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        Ok(self.client.post(url).headers(headers).json(&body).send().await?.error_for_status()?)
    }
}
```

**Step 4: Run tests**

```bash
cargo test -p openduo-core 2>&1
```
Expected: all pass.

**Step 5: Commit**

```bash
git add crates/openduo-core/
git commit -m "feat(core): add GitLabClient with get/post/put + streaming support"
```

---

### Task 5: openduo-server — Axum Server with /health

**Files:**
- Create: `crates/openduo-server/src/main.rs`
- Create: `crates/openduo-server/src/routes.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-server/src/routes.rs (add at bottom)
#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_health_returns_ok() {
        let app = health_router();
        let req = Request::builder().uri("/health").body(Body::empty()).unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
```

**Step 2: Run to verify failure**

```bash
cargo test -p openduo-server 2>&1
```

**Step 3: Implement server**

```rust
// crates/openduo-server/src/routes.rs
use axum::{response::Json, routing::get, Router};
use serde_json::{json, Value};

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "openduo-server" }))
}

pub fn health_router() -> Router {
    Router::new().route("/health", get(health))
}
```

```rust
// crates/openduo-server/src/main.rs
mod routes;

use anyhow::Result;
use openduo_core::config::Config;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let port = config.server_port;
    let addr = format!("127.0.0.1:{}", port);

    let app = routes::health_router();

    info!("openduo-server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

**Step 4: Add tower to server Cargo.toml (for tests)**

```toml
[dev-dependencies]
tower = { version = "0.4", features = ["util"] }
http-body-util = "0.1"
```

**Step 5: Run tests**

```bash
cargo test -p openduo-server 2>&1
```
Expected: `test_health_returns_ok` passes.

**Step 6: Commit**

```bash
git add crates/openduo-server/
git commit -m "feat(server): add Axum server with /health endpoint"
```

---

### Task 6: VS Code Extension — Scaffold

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/esbuild.config.js`
- Create: `extension/.vscodeignore`
- Create: `extension/src/extension.ts` (stub)

**Step 1: Create package.json**

```json
{
  "name": "openduo",
  "displayName": "OpenDuo",
  "description": "GitLab Duo Agentic Chat for Federal Enterprise",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "openduo.openChat",
        "title": "OpenDuo: Open Chat"
      },
      {
        "command": "openduo.configurePat",
        "title": "OpenDuo: Configure PAT"
      }
    ],
    "configuration": {
      "title": "OpenDuo",
      "properties": {
        "openduo.gitlabUrl": {
          "type": "string",
          "default": "",
          "description": "GitLab instance URL (e.g. https://gitlab.example.com)"
        }
      }
    }
  },
  "scripts": {
    "build": "node esbuild.config.js",
    "watch": "node esbuild.config.js --watch",
    "test": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0",
    "@vscode/vsce": "^2.24.0"
  },
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "webview/**/*"]
}
```

**Step 3: Create esbuild.config.js**

```javascript
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

// Extension host bundle
esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  watch: watch ? { onRebuild(err) { if(err) console.error(err); else console.log('Extension rebuilt'); } } : false,
}).catch(() => process.exit(1));

// Webview React bundle
esbuild.build({
  entryPoints: ['webview/index.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  watch: watch ? { onRebuild(err) { if(err) console.error(err); else console.log('Webview rebuilt'); } } : false,
}).catch(() => process.exit(1));
```

**Step 4: Create stub extension.ts**

```typescript
// extension/src/extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    console.log('OpenDuo activating...');
}

export function deactivate(): void {}
```

**Step 5: Create .vscodeignore**

```
node_modules/
src/
webview/
*.ts
*.tsx
*.map
esbuild.config.js
tsconfig.json
```

**Step 6: Install dependencies and build**

```bash
cd extension && npm install && npm run build
```
Expected: `dist/extension.js` created.

**Step 7: Commit**

```bash
cd .. && git add extension/
git commit -m "chore(extension): scaffold VS Code extension with esbuild"
```

---

### Task 7: Extension — PAT Manager

**Files:**
- Create: `extension/src/patManager.ts`
- Create: `extension/src/patManager.test.ts`

**Step 1: Write failing test**

```typescript
// extension/src/patManager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PatManager } from './patManager';

const mockSecrets = {
  store: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  onDidChange: { event: vi.fn() },
};

describe('PatManager', () => {
  it('stores PAT via SecretStorage', async () => {
    const pm = new PatManager(mockSecrets as any);
    await pm.store('glpat-abc123');
    expect(mockSecrets.store).toHaveBeenCalledWith('openduo.pat', 'glpat-abc123');
  });

  it('retrieves PAT from SecretStorage', async () => {
    mockSecrets.get.mockResolvedValue('glpat-abc123');
    const pm = new PatManager(mockSecrets as any);
    const pat = await pm.get();
    expect(pat).toBe('glpat-abc123');
  });

  it('returns undefined when no PAT stored', async () => {
    mockSecrets.get.mockResolvedValue(undefined);
    const pm = new PatManager(mockSecrets as any);
    const pat = await pm.get();
    expect(pat).toBeUndefined();
  });
});
```

**Step 2: Run to verify failure**

```bash
cd extension && npm test 2>&1
```

**Step 3: Implement PatManager**

```typescript
// extension/src/patManager.ts
import * as vscode from 'vscode';

const PAT_KEY = 'openduo.pat';

export class PatManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async store(pat: string): Promise<void> {
    await this.secrets.store(PAT_KEY, pat);
  }

  async get(): Promise<string | undefined> {
    return this.secrets.get(PAT_KEY);
  }

  async delete(): Promise<void> {
    await this.secrets.delete(PAT_KEY);
  }

  async prompt(context: vscode.ExtensionContext): Promise<string | undefined> {
    const pat = await vscode.window.showInputBox({
      prompt: 'Enter your GitLab Personal Access Token (requires api, read_user, ai_features scopes)',
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => v.startsWith('glpat-') ? null : 'PAT must start with glpat-',
    });
    if (pat) {
      await this.store(pat);
    }
    return pat;
  }
}
```

**Step 4: Run tests**

```bash
npm test 2>&1
```
Expected: 3 tests pass.

**Step 5: Commit**

```bash
cd .. && git add extension/src/patManager.ts extension/src/patManager.test.ts
git commit -m "feat(extension): add PatManager backed by VS Code SecretStorage"
```

---

### Task 8: Extension — Server Lifecycle Manager

**Files:**
- Create: `extension/src/server.ts`
- Create: `extension/src/server.test.ts`

**Step 1: Write failing test**

```typescript
// extension/src/server.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ServerManager } from './server';

describe('ServerManager', () => {
  it('constructs with binary path and env', () => {
    const sm = new ServerManager('/fake/openduo-server.exe', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.isRunning()).toBe(false);
  });

  it('generates a valid localhost URL', () => {
    const sm = new ServerManager('/fake/openduo-server.exe', {
      GITLAB_URL: 'https://gitlab.example.com',
      GITLAB_PAT: 'glpat-test',
    });
    expect(sm.serverUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
```

**Step 2: Run to verify failure**

```bash
cd extension && npm test 2>&1
```

**Step 3: Implement ServerManager**

```typescript
// extension/src/server.ts
import * as cp from 'child_process';
import * as vscode from 'vscode';

const DEFAULT_PORT = 8745;

export class ServerManager {
  private process: cp.ChildProcess | null = null;
  private readonly port: number;
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(
    private readonly binaryPath: string,
    private readonly env: Record<string, string>,
    port: number = DEFAULT_PORT
  ) {
    this.port = port;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  serverUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async start(outputChannel: vscode.OutputChannel): Promise<void> {
    if (this.isRunning()) return;
    this.outputChannel = outputChannel;

    this.process = cp.spawn(this.binaryPath, [], {
      env: {
        ...process.env,
        ...this.env,
        OPENDUO_PORT: String(this.port),
        RUST_LOG: 'info',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.stderr?.on('data', (d: Buffer) => outputChannel.append(d.toString()));
    this.process.on('exit', (code) => {
      outputChannel.appendLine(`[OpenDuo] Server exited with code ${code}`);
      this.process = null;
    });

    await this.waitForHealth();
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  private async waitForHealth(timeoutMs = 5000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await fetch(`${this.serverUrl()}/health`);
        if (resp.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('openduo-server failed to start within timeout');
  }
}
```

**Step 4: Run tests**

```bash
npm test 2>&1
```
Expected: 2 tests pass.

**Step 5: Commit**

```bash
cd .. && git add extension/src/server.ts extension/src/server.test.ts
git commit -m "feat(extension): add ServerManager to spawn and monitor Rust binary"
```

---

### Task 9: Extension — Wire Commands + Activate

**Files:**
- Modify: `extension/src/extension.ts`
- Create: `extension/src/logger.ts`

**Step 1: Create logger.ts**

```typescript
// extension/src/logger.ts
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('OpenDuo');
  }
  return channel;
}

export function log(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}
```

**Step 2: Implement full extension.ts**

```typescript
// extension/src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { PatManager } from './patManager';
import { ServerManager } from './server';
import { getOutputChannel, log } from './logger';

let serverManager: ServerManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('OpenDuo activating...');

  const patManager = new PatManager(context.secrets);
  const binaryPath = path.join(context.extensionPath, 'bin', 'openduo-server.exe');
  const gitlabUrl = vscode.workspace.getConfiguration('openduo').get<string>('gitlabUrl', '');

  // Register: Configure PAT
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.configurePat', async () => {
      await patManager.prompt(context);
      vscode.window.showInformationMessage('OpenDuo: PAT saved successfully.');
    })
  );

  // Register: Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('openduo.openChat', async () => {
      const pat = await patManager.get();
      if (!pat) {
        const action = await vscode.window.showWarningMessage(
          'OpenDuo: No PAT configured.',
          'Configure PAT'
        );
        if (action === 'Configure PAT') {
          await vscode.commands.executeCommand('openduo.configurePat');
        }
        return;
      }
      if (!gitlabUrl) {
        vscode.window.showErrorMessage('OpenDuo: Set openduo.gitlabUrl in settings.');
        return;
      }
      if (!serverManager || !serverManager.isRunning()) {
        serverManager = new ServerManager(binaryPath, {
          GITLAB_URL: gitlabUrl,
          GITLAB_PAT: pat,
        });
        await serverManager.start(getOutputChannel());
      }
      log('Server running at ' + serverManager.serverUrl());
      vscode.window.showInformationMessage('OpenDuo: Server started. Chat coming in Phase 4.');
    })
  );

  context.subscriptions.push({
    dispose: () => { serverManager?.stop(); }
  });

  log('OpenDuo activated.');
}

export function deactivate(): void {
  serverManager?.stop();
}
```

**Step 3: Build**

```bash
cd extension && npm run build 2>&1
```
Expected: no TypeScript errors.

**Step 4: Commit**

```bash
cd .. && git add extension/src/
git commit -m "feat(extension): wire activate(), configurePat, openChat commands"
```

---

### Task 10: Phase 1 — Integration Smoke Test

**Step 1: Build the Rust server binary**

```bash
cargo build -p openduo-server 2>&1
```
Expected: `target/debug/openduo-server.exe` produced.

**Step 2: Run server manually**

```bash
GITLAB_URL=https://gitlab.example.com GITLAB_PAT=glpat-test ./target/debug/openduo-server.exe &
sleep 1
curl http://127.0.0.1:8745/health
```
Expected: `{"status":"ok","service":"openduo-server"}`

**Step 3: Kill server**

```bash
pkill openduo-server
```

**Step 4: Run all tests**

```bash
cargo test --workspace 2>&1 && cd extension && npm test 2>&1
```
Expected: all Rust tests pass, all TS tests pass.

**Step 5: Commit**

```bash
cd .. && git add .
git commit -m "test: Phase 1 smoke test - server health endpoint verified"
```

---

## Phase 2 — Agent Engine

### Task 11: openduo-agent — LlmProvider Trait

**Files:**
- Create: `crates/openduo-agent/src/provider.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-agent/tests/provider_test.rs
use openduo_agent::provider::{ChatMessage, ChatRole};

#[test]
fn test_chat_message_serializes() {
    let msg = ChatMessage { role: ChatRole::User, content: "hello".to_string() };
    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"user\""));
    assert!(json.contains("\"hello\""));
}
```

**Step 2: Implement provider.rs**

```rust
// crates/openduo-agent/src/provider.rs
use anyhow::Result;
use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use std::pin::Pin;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
pub enum ModelResponse {
    Token(String),
    ToolCall(ToolCall),
    Done,
}

pub type TokenStream = Pin<Box<dyn Stream<Item = Result<ModelResponse>> + Send>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        tools: Vec<ToolDefinition>,
    ) -> Result<TokenStream>;
}
```

**Step 3: Run tests and commit**

```bash
cargo test -p openduo-agent 2>&1
git add crates/openduo-agent/src/provider.rs crates/openduo-agent/tests/
git commit -m "feat(agent): add LlmProvider trait with streaming types"
```

---

### Task 12: openduo-agent — GitLab AI Gateway SSE Implementation

**Files:**
- Create: `crates/openduo-agent/src/gitlab_provider.rs`
- Modify: `crates/openduo-agent/src/lib.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-agent/tests/gitlab_provider_test.rs
use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_core::config::Config;

#[test]
fn test_provider_constructs() {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    let config = Config::from_env().unwrap();
    let _provider = GitLabAiProvider::new(config);
}
```

**Step 2: Implement GitLabAiProvider**

```rust
// crates/openduo-agent/src/gitlab_provider.rs
use crate::provider::{ChatMessage, ChatRole, LlmProvider, ModelResponse, TokenStream, ToolCall, ToolDefinition};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::StreamExt;
use openduo_core::{auth::AuthHeaders, config::Config};
use reqwest::Client;
use serde_json::{json, Value};
use tracing::{debug, instrument};

pub struct GitLabAiProvider {
    client: Client,
    gateway_url: String,
    pat: String,
    model: String,
}

impl GitLabAiProvider {
    pub fn new(config: Config) -> Self {
        let client = Client::builder()
            .use_native_tls()
            .build()
            .expect("Failed to build reqwest client");
        let gateway_url = format!("{}/api/v4/chat/completions", config.gitlab_url.trim_end_matches('/'));
        Self {
            client,
            gateway_url,
            pat: config.pat,
            model: "claude-sonnet-4-5".to_string(),
        }
    }

    fn build_request_body(&self, messages: &[ChatMessage], tools: &[ToolDefinition]) -> Value {
        let msgs: Vec<Value> = messages.iter().map(|m| json!({
            "role": m.role,
            "content": m.content,
        })).collect();

        let mut body = json!({
            "model": self.model,
            "messages": msgs,
            "stream": true,
        });

        if !tools.is_empty() {
            let tool_defs: Vec<Value> = tools.iter().map(|t| json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })).collect();
            body["tools"] = json!(tool_defs);
            body["tool_choice"] = json!("auto");
        }
        body
    }
}

#[async_trait]
impl LlmProvider for GitLabAiProvider {
    #[instrument(skip(self, messages, tools))]
    async fn chat_stream(&self, messages: Vec<ChatMessage>, tools: Vec<ToolDefinition>) -> Result<TokenStream> {
        let headers = AuthHeaders::new(&self.pat).to_header_map()?;
        let body = self.build_request_body(&messages, &tools);
        debug!("Sending to GitLab AI Gateway: {}", self.gateway_url);

        let resp = self.client
            .post(&self.gateway_url)
            .headers(headers)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;

        let stream = resp.bytes_stream().map(move |chunk| {
            let bytes = chunk.map_err(|e| anyhow!(e))?;
            let text = String::from_utf8_lossy(&bytes).to_string();

            // Parse SSE: "data: {...}\n\n"
            for line in text.lines() {
                if let Some(json_str) = line.strip_prefix("data: ") {
                    if json_str == "[DONE]" { return Ok(ModelResponse::Done); }
                    if let Ok(val) = serde_json::from_str::<Value>(json_str) {
                        // Tool call
                        if let Some(tc) = val["choices"][0]["delta"]["tool_calls"][0].as_object() {
                            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                            let args_str = tc["function"]["arguments"].as_str().unwrap_or("{}");
                            let arguments = serde_json::from_str(args_str).unwrap_or(json!({}));
                            return Ok(ModelResponse::ToolCall(ToolCall { name, arguments }));
                        }
                        // Token
                        if let Some(token) = val["choices"][0]["delta"]["content"].as_str() {
                            return Ok(ModelResponse::Token(token.to_string()));
                        }
                    }
                }
            }
            Ok(ModelResponse::Done)
        });

        Ok(Box::pin(stream))
    }
}
```

**Step 3: Add to lib.rs**

```rust
// crates/openduo-agent/src/lib.rs
pub mod gitlab_provider;
pub mod prompt;
pub mod provider;
pub mod react_loop;
```

**Step 4: Run tests and commit**

```bash
cargo test -p openduo-agent 2>&1
git add crates/openduo-agent/
git commit -m "feat(agent): add GitLabAiProvider with SSE streaming"
```

---

### Task 13: openduo-agent — Prompt Builder

**Files:**
- Create: `crates/openduo-agent/src/prompt.rs`
- Create: `crates/openduo-agent/tests/prompt_test.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-agent/tests/prompt_test.rs
use openduo_agent::prompt::PromptBuilder;
use openduo_agent::provider::{ChatMessage, ChatRole};

#[test]
fn test_prompt_contains_system_message() {
    let msgs = PromptBuilder::build_initial("https://gitlab.example.com", "test user");
    assert!(matches!(msgs[0].role, ChatRole::System));
    assert!(msgs[0].content.contains("GitLab"));
}

#[test]
fn test_append_user_message() {
    let mut history = PromptBuilder::build_initial("https://gitlab.example.com", "testuser");
    PromptBuilder::append_user(&mut history, "List my open issues");
    let last = history.last().unwrap();
    assert!(matches!(last.role, ChatRole::User));
    assert_eq!(last.content, "List my open issues");
}
```

**Step 2: Implement PromptBuilder**

```rust
// crates/openduo-agent/src/prompt.rs
use crate::provider::{ChatMessage, ChatRole};

pub struct PromptBuilder;

impl PromptBuilder {
    pub fn build_initial(gitlab_url: &str, username: &str) -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: ChatRole::System,
            content: format!(
                "You are OpenDuo, an AI assistant integrated with GitLab at {}. \
                You help {} interact with their GitLab instance by using available tools. \
                Always think step-by-step. Use tools to fetch real data before answering. \
                Never fabricate issue numbers, pipeline IDs, or commit hashes. \
                When you have enough information, provide a clear, concise answer.",
                gitlab_url, username
            ),
        }]
    }

    pub fn append_user(history: &mut Vec<ChatMessage>, content: &str) {
        history.push(ChatMessage {
            role: ChatRole::User,
            content: content.to_string(),
        });
    }

    pub fn append_assistant(history: &mut Vec<ChatMessage>, content: &str) {
        history.push(ChatMessage {
            role: ChatRole::Assistant,
            content: content.to_string(),
        });
    }

    pub fn append_tool_result(history: &mut Vec<ChatMessage>, tool_name: &str, result: &str) {
        history.push(ChatMessage {
            role: ChatRole::Tool,
            content: format!("Tool `{}` returned:\n{}", tool_name, result),
        });
    }
}
```

**Step 3: Run tests and commit**

```bash
cargo test -p openduo-agent 2>&1
git add crates/openduo-agent/
git commit -m "feat(agent): add PromptBuilder for system prompt and history management"
```

---

### Task 14: openduo-agent — ReAct Loop

**Files:**
- Create: `crates/openduo-agent/src/react_loop.rs`
- Create: `crates/openduo-agent/tests/react_loop_test.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-agent/tests/react_loop_test.rs
use openduo_agent::react_loop::ReactLoop;

#[test]
fn test_react_loop_constructs_with_max_iterations() {
    let _loop_runner = ReactLoop::new(10);
    // If it constructs, the test passes
}
```

**Step 2: Implement ReactLoop**

```rust
// crates/openduo-agent/src/react_loop.rs
use crate::prompt::PromptBuilder;
use crate::provider::{ChatMessage, LlmProvider, ModelResponse, ToolDefinition};
use anyhow::Result;
use futures::StreamExt;
use openduo_tools::registry::ToolRegistry;
use std::sync::Arc;
use tracing::{info, warn};

pub struct ReactLoop {
    max_iterations: usize,
}

impl ReactLoop {
    pub fn new(max_iterations: usize) -> Self {
        Self { max_iterations }
    }

    pub async fn run(
        &self,
        user_message: &str,
        history: &mut Vec<ChatMessage>,
        provider: &Arc<dyn LlmProvider>,
        tools: &ToolRegistry,
        gitlab_url: &str,
        username: &str,
        on_token: impl Fn(String) + Send,
    ) -> Result<String> {
        PromptBuilder::append_user(history, user_message);
        let tool_defs = tools.definitions();
        let mut final_response = String::new();

        for iteration in 0..self.max_iterations {
            info!("ReAct iteration {}", iteration + 1);
            let mut stream = provider.chat_stream(history.clone(), tool_defs.clone()).await?;
            let mut current_response = String::new();
            let mut tool_call_name: Option<String> = None;
            let mut tool_call_args: Option<serde_json::Value> = None;

            while let Some(event) = stream.next().await {
                match event? {
                    ModelResponse::Token(token) => {
                        on_token(token.clone());
                        current_response.push_str(&token);
                    }
                    ModelResponse::ToolCall(tc) => {
                        tool_call_name = Some(tc.name);
                        tool_call_args = Some(tc.arguments);
                    }
                    ModelResponse::Done => break,
                }
            }

            if let (Some(name), Some(args)) = (tool_call_name, tool_call_args) {
                info!("Executing tool: {}", name);
                let result = tools.execute(&name, args).await
                    .unwrap_or_else(|e| format!("Tool error: {}", e));
                PromptBuilder::append_assistant(history, &format!("[Using tool: {}]", name));
                PromptBuilder::append_tool_result(history, &name, &result);
            } else {
                // No tool call — final answer
                final_response = current_response.clone();
                PromptBuilder::append_assistant(history, &current_response);
                break;
            }

            if iteration + 1 == self.max_iterations {
                warn!("Max ReAct iterations ({}) reached", self.max_iterations);
                final_response = "I've reached the maximum number of reasoning steps. Please try rephrasing your question.".to_string();
            }
        }

        Ok(final_response)
    }
}
```

**Step 3: Run tests and commit**

```bash
cargo test -p openduo-agent 2>&1
git add crates/openduo-agent/
git commit -m "feat(agent): add ReAct loop with max 10 iteration guard"
```

---

### Task 15: openduo-server — /chat SSE Route

**Files:**
- Create: `crates/openduo-server/src/sse.rs`
- Modify: `crates/openduo-server/src/routes.rs`
- Modify: `crates/openduo-server/src/main.rs`

**Step 1: Write failing test**

```rust
// Add to crates/openduo-server/src/routes.rs tests
#[tokio::test]
async fn test_chat_route_exists() {
    // Just verify the router builds without panic
    let _app = build_router(build_test_state());
}
```

**Step 2: Implement SSE + chat route**

```rust
// crates/openduo-server/src/sse.rs
use axum::response::sse::{Event, KeepAlive, Sse};
use futures::stream::Stream;
use std::convert::Infallible;

pub fn sse_response<S>(stream: S) -> Sse<impl Stream<Item = Result<Event, Infallible>>>
where
    S: Stream<Item = String> + Send + 'static,
{
    use futures::StreamExt;
    let event_stream = stream.map(|data| {
        Ok::<_, Infallible>(Event::default().data(data))
    });
    Sse::new(event_stream).keep_alive(KeepAlive::default())
}
```

```rust
// crates/openduo-server/src/routes.rs — full replacement
use axum::{
    extract::State,
    response::{Json, Sse},
    routing::{get, post},
    Router,
};
use openduo_agent::{gitlab_provider::GitLabAiProvider, react_loop::ReactLoop};
use openduo_core::config::Config;
use openduo_tools::registry::ToolRegistry;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    pub provider: Arc<dyn openduo_agent::provider::LlmProvider>,
    pub tools: Arc<ToolRegistry>,
    pub gitlab_url: String,
    pub history: Arc<Mutex<Vec<openduo_agent::provider::ChatMessage>>>,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    pub message: String,
    pub username: Option<String>,
}

pub async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "openduo-server" }))
}

pub async fn tools_list(State(state): State<AppState>) -> Json<Value> {
    let defs = state.tools.definitions();
    Json(json!({ "tools": defs }))
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/tools", get(tools_list))
        .route("/chat", post(chat_handler))
        .with_state(state)
}

pub async fn chat_handler(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Sse<impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>>> {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    let provider = state.provider.clone();
    let tools = state.tools.clone();
    let gitlab_url = state.gitlab_url.clone();
    let history = state.history.clone();
    let username = req.username.unwrap_or_else(|| "user".to_string());
    let message = req.message.clone();

    tokio::spawn(async move {
        let react_loop = ReactLoop::new(10);
        let mut hist = history.lock().await;
        let _ = react_loop.run(
            &message,
            &mut hist,
            &provider,
            &tools,
            &gitlab_url,
            &username,
            |token| { let _ = tx.send(token); },
        ).await;
        let _ = tx.send("[DONE]".to_string());
    });

    use futures::StreamExt;
    let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx)
        .map(|data| Ok::<_, std::convert::Infallible>(axum::response::sse::Event::default().data(data)));
    Sse::new(stream).keep_alive(axum::response::sse::KeepAlive::default())
}

#[cfg(test)]
pub fn build_test_state() -> AppState {
    unimplemented!("test state requires mock provider")
}
```

**Step 3: Update main.rs**

```rust
// crates/openduo-server/src/main.rs
mod routes;
mod sse;

use anyhow::Result;
use openduo_agent::gitlab_provider::GitLabAiProvider;
use openduo_core::config::Config;
use openduo_tools::registry::ToolRegistry;
use routes::{AppState, build_router};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let port = config.server_port;
    let gitlab_url = config.gitlab_url.clone();

    let provider = Arc::new(GitLabAiProvider::new(config.clone()));
    let tools = Arc::new(ToolRegistry::new(config));
    let history = Arc::new(Mutex::new(Vec::new()));

    let state = AppState { provider, tools, gitlab_url, history };
    let app = build_router(state);

    let addr = format!("127.0.0.1:{}", port);
    info!("openduo-server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

**Step 4: Build (tools not implemented yet — will add stubs in Task 18)**

```bash
cargo build -p openduo-server 2>&1
```

**Step 5: Commit**

```bash
git add crates/openduo-server/
git commit -m "feat(server): add /chat SSE route and /tools endpoint"
```

---

## Phase 3 — Tool Engine

### Task 16: openduo-tools — Tool Trait + ToolRegistry

**Files:**
- Create: `crates/openduo-tools/src/registry.rs`
- Create: `crates/openduo-tools/tests/registry_test.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-tools/tests/registry_test.rs
use openduo_tools::registry::ToolRegistry;
use openduo_core::config::Config;

fn test_config() -> Config {
    std::env::set_var("GITLAB_URL", "https://gitlab.example.com");
    std::env::set_var("GITLAB_PAT", "glpat-test");
    Config::from_env().unwrap()
}

#[test]
fn test_registry_has_tools() {
    let registry = ToolRegistry::new(test_config());
    assert!(!registry.definitions().is_empty());
}

#[test]
fn test_registry_lists_expected_tools() {
    let registry = ToolRegistry::new(test_config());
    let names: Vec<String> = registry.definitions().iter().map(|t| t.name.clone()).collect();
    assert!(names.contains(&"list_issues".to_string()));
    assert!(names.contains(&"get_pipeline".to_string()));
    assert!(names.contains(&"get_file".to_string()));
}
```

**Step 2: Implement Tool trait and ToolRegistry skeleton**

```rust
// crates/openduo-tools/src/registry.rs
use crate::issues::IssuesTools;
use crate::merge_requests::MergeRequestTools;
use crate::pipelines::PipelineTools;
use crate::repositories::RepositoryTools;
use crate::projects::ProjectTools;
use crate::users::UserTools;
use crate::cicd::CicdTools;
use crate::milestones::MilestoneTools;
use crate::labels::LabelTools;
use anyhow::Result;
use async_trait::async_trait;
use openduo_agent::provider::ToolDefinition;
use openduo_core::{config::Config, gitlab_client::GitLabClient};
use std::collections::HashMap;

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters_schema(&self) -> serde_json::Value;
    async fn execute(&self, args: serde_json::Value) -> Result<String>;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters_schema(),
        }
    }
}

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new(config: Config) -> Self {
        let client = GitLabClient::new(config);
        let mut tools: HashMap<String, Box<dyn Tool>> = HashMap::new();

        for tool in IssuesTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in MergeRequestTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in PipelineTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in RepositoryTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in ProjectTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in UserTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in CicdTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in MilestoneTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }
        for tool in LabelTools::all(client.clone()) {
            tools.insert(tool.name().to_string(), tool);
        }

        Self { tools }
    }

    pub fn definitions(&self) -> Vec<ToolDefinition> {
        self.tools.values().map(|t| t.definition()).collect()
    }

    pub async fn execute(&self, name: &str, args: serde_json::Value) -> Result<String> {
        match self.tools.get(name) {
            Some(tool) => tool.execute(args).await,
            None => anyhow::bail!("Unknown tool: {}", name),
        }
    }
}
```

**Step 3: Create stub modules for all tool domains**

Each domain file follows the same pattern. Here is `issues.rs` in full; all others follow the same structure (see Task 17 for remaining domains).

```rust
// crates/openduo-tools/src/issues.rs
use crate::registry::Tool;
use anyhow::Result;
use async_trait::async_trait;
use openduo_core::gitlab_client::GitLabClient;
use serde_json::{json, Value};

pub struct IssuesTools;

impl IssuesTools {
    pub fn all(client: GitLabClient) -> Vec<Box<dyn Tool>> {
        vec![
            Box::new(ListIssues { client: client.clone() }),
            Box::new(GetIssue { client: client.clone() }),
            Box::new(CreateIssue { client: client.clone() }),
            Box::new(UpdateIssue { client: client.clone() }),
            Box::new(CloseIssue { client: client.clone() }),
            Box::new(AddIssueComment { client: client.clone() }),
        ]
    }
}

// --- list_issues ---
struct ListIssues { client: GitLabClient }

#[async_trait]
impl Tool for ListIssues {
    fn name(&self) -> &str { "list_issues" }
    fn description(&self) -> &str { "List issues for a GitLab project. Supports filtering by state, assignee, labels." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string", "description": "Project ID or URL-encoded path (e.g. 'group/project')" },
                "state": { "type": "string", "enum": ["opened", "closed", "all"], "default": "opened" },
                "assignee_username": { "type": "string", "description": "Filter by assignee username" },
                "labels": { "type": "string", "description": "Comma-separated label names" },
                "per_page": { "type": "integer", "default": 20, "maximum": 100 }
            },
            "required": ["project_id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = args["project_id"].as_str().ok_or_else(|| anyhow::anyhow!("project_id required"))?;
        let encoded = urlencoding::encode(project_id);
        let mut path = format!("projects/{}/issues", encoded);
        let state = args["state"].as_str().unwrap_or("opened");
        let per_page = args["per_page"].as_u64().unwrap_or(20);
        path.push_str(&format!("?state={}&per_page={}", state, per_page));
        if let Some(assignee) = args["assignee_username"].as_str() {
            path.push_str(&format!("&assignee_username={}", assignee));
        }
        if let Some(labels) = args["labels"].as_str() {
            path.push_str(&format!("&labels={}", labels));
        }
        let issues: Vec<Value> = self.client.get(&path).await?;
        Ok(serde_json::to_string_pretty(&issues)?)
    }
}

// --- get_issue ---
struct GetIssue { client: GitLabClient }

#[async_trait]
impl Tool for GetIssue {
    fn name(&self) -> &str { "get_issue" }
    fn description(&self) -> &str { "Get a specific issue by ID." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer", "description": "Issue internal ID (iid)" }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let issue: Value = self.client.get(&format!("projects/{}/issues/{}", project_id, iid)).await?;
        Ok(serde_json::to_string_pretty(&issue)?)
    }
}

// --- create_issue ---
struct CreateIssue { client: GitLabClient }

#[async_trait]
impl Tool for CreateIssue {
    fn name(&self) -> &str { "create_issue" }
    fn description(&self) -> &str { "Create a new issue in a GitLab project." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "labels": { "type": "string" },
                "assignee_ids": { "type": "array", "items": { "type": "integer" } }
            },
            "required": ["project_id", "title"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let issue: Value = self.client.post(
            &format!("projects/{}/issues", project_id), args
        ).await?;
        Ok(serde_json::to_string_pretty(&issue)?)
    }
}

// --- update_issue ---
struct UpdateIssue { client: GitLabClient }

#[async_trait]
impl Tool for UpdateIssue {
    fn name(&self) -> &str { "update_issue" }
    fn description(&self) -> &str { "Update an existing issue's title, description, labels, or assignees." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "labels": { "type": "string" },
                "state_event": { "type": "string", "enum": ["close", "reopen"] }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let issue: Value = self.client.put(
            &format!("projects/{}/issues/{}", project_id, iid), args
        ).await?;
        Ok(serde_json::to_string_pretty(&issue)?)
    }
}

// --- close_issue ---
struct CloseIssue { client: GitLabClient }

#[async_trait]
impl Tool for CloseIssue {
    fn name(&self) -> &str { "close_issue" }
    fn description(&self) -> &str { "Close an open issue." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" }
            },
            "required": ["project_id", "issue_iid"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let result: Value = self.client.put(
            &format!("projects/{}/issues/{}", project_id, iid),
            json!({ "state_event": "close" })
        ).await?;
        Ok(serde_json::to_string_pretty(&result)?)
    }
}

// --- add_issue_comment ---
struct AddIssueComment { client: GitLabClient }

#[async_trait]
impl Tool for AddIssueComment {
    fn name(&self) -> &str { "add_issue_comment" }
    fn description(&self) -> &str { "Add a note/comment to a GitLab issue." }
    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_id": { "type": "string" },
                "issue_iid": { "type": "integer" },
                "body": { "type": "string", "description": "Comment text (Markdown supported)" }
            },
            "required": ["project_id", "issue_iid", "body"]
        })
    }
    async fn execute(&self, args: Value) -> Result<String> {
        let project_id = urlencoding::encode(args["project_id"].as_str().unwrap_or_default());
        let iid = args["issue_iid"].as_u64().ok_or_else(|| anyhow::anyhow!("issue_iid required"))?;
        let note: Value = self.client.post(
            &format!("projects/{}/issues/{}/notes", project_id, iid),
            json!({ "body": args["body"] })
        ).await?;
        Ok(serde_json::to_string_pretty(&note)?)
    }
}
```

**Step 4: Add `urlencoding` to openduo-tools Cargo.toml**

```toml
urlencoding = "2"
```

**Step 5: Run tests and commit**

```bash
cargo test -p openduo-tools 2>&1
git add crates/openduo-tools/
git commit -m "feat(tools): add Tool trait, ToolRegistry, and Issues domain (6 tools)"
```

---

### Task 17: Remaining Tool Domains

> **Pattern:** Each domain follows the exact same structure as `issues.rs`. Copy the pattern for each domain below. Files to create: `merge_requests.rs`, `pipelines.rs`, `repositories.rs`, `projects.rs`, `users.rs`, `cicd.rs`, `milestones.rs`, `labels.rs`.

**merge_requests.rs** — Tools: `list_mrs`, `get_mr`, `create_mr`, `update_mr`, `merge_mr`, `add_mr_comment`, `get_mr_diff`

Key API paths:
- `GET projects/{id}/merge_requests` → `list_mrs`
- `GET projects/{id}/merge_requests/{iid}` → `get_mr`
- `POST projects/{id}/merge_requests` → `create_mr` (params: `source_branch`, `target_branch`, `title`)
- `PUT projects/{id}/merge_requests/{iid}` → `update_mr`
- `PUT projects/{id}/merge_requests/{iid}/merge` → `merge_mr`
- `POST projects/{id}/merge_requests/{iid}/notes` → `add_mr_comment`
- `GET projects/{id}/merge_requests/{iid}/diffs` → `get_mr_diff`

**pipelines.rs** — Tools: `list_pipelines`, `get_pipeline`, `trigger_pipeline`, `retry_pipeline`, `cancel_pipeline`, `get_job_log`

Key API paths:
- `GET projects/{id}/pipelines` → `list_pipelines`
- `GET projects/{id}/pipelines/{pipeline_id}` → `get_pipeline`
- `POST projects/{id}/pipeline` (params: `ref`) → `trigger_pipeline`
- `POST projects/{id}/pipelines/{pipeline_id}/retry` → `retry_pipeline`
- `POST projects/{id}/pipelines/{pipeline_id}/cancel` → `cancel_pipeline`
- `GET projects/{id}/jobs/{job_id}/trace` → `get_job_log` (returns raw text)

**repositories.rs** — Tools: `get_file`, `list_files`, `search_code`, `get_commit`, `list_commits`, `compare_refs`

Key API paths:
- `GET projects/{id}/repository/files/{file_path}?ref={ref}` → `get_file`
- `GET projects/{id}/repository/tree?path={path}&ref={ref}` → `list_files`
- `GET projects/{id}/search?scope=blobs&search={query}` → `search_code`
- `GET projects/{id}/repository/commits/{sha}` → `get_commit`
- `GET projects/{id}/repository/commits?ref_name={ref}` → `list_commits`
- `GET projects/{id}/repository/compare?from={from}&to={to}` → `compare_refs`

**projects.rs** — Tools: `get_project`, `list_projects`, `search_projects`

Key API paths:
- `GET projects/{id}` → `get_project`
- `GET projects?membership=true` → `list_projects`
- `GET projects?search={query}` → `search_projects`

**users.rs** — Tools: `get_current_user`, `list_project_members`

Key API paths:
- `GET user` → `get_current_user`
- `GET projects/{id}/members` → `list_project_members`

**cicd.rs** — Tools: `get_pipeline_yaml`, `validate_pipeline_yaml`, `list_runners`

Key API paths:
- `GET projects/{id}/repository/files/.gitlab-ci.yml?ref=main` → `get_pipeline_yaml`
- `POST ci/lint` (body: `{content: "..."}`) → `validate_pipeline_yaml`
- `GET runners?scope=active` → `list_runners`

**milestones.rs** — Tools: `list_milestones`

Key API paths:
- `GET projects/{id}/milestones` → `list_milestones`

**labels.rs** — Tools: `list_labels`, `create_label`

Key API paths:
- `GET projects/{id}/labels` → `list_labels`
- `POST projects/{id}/labels` (params: `name`, `color`) → `create_label`

**Step: After implementing all domains, run tests and commit**

```bash
cargo test -p openduo-tools 2>&1
git add crates/openduo-tools/
git commit -m "feat(tools): add all 30+ tool implementations across 9 domains"
```

---

### Task 18: Phase 3 Integration — Full Agentic Chat Smoke Test

**Step 1: Build release binary**

```bash
cargo build --release -p openduo-server 2>&1
```

**Step 2: Start server with real PAT and test /tools**

```bash
GITLAB_URL=https://your-gitlab.example.com GITLAB_PAT=glpat-yourtoken \
  ./target/release/openduo-server.exe &
sleep 2
curl http://127.0.0.1:8745/tools | python -m json.tool | head -40
```
Expected: JSON list of 30+ tool definitions.

**Step 3: Smoke-test /chat with a real message**

```bash
curl -N -X POST http://127.0.0.1:8745/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Who am I? Use the get_current_user tool.", "username": "me"}' 2>&1
```
Expected: SSE stream of tokens ending with `[DONE]`.

**Step 4: Kill server and commit**

```bash
pkill openduo-server
git add .
git commit -m "test: Phase 3 integration - full agentic chat verified"
```

---

## Phase 4 — React Chat UI

### Task 19: Webview — Setup + Base HTML

**Files:**
- Create: `extension/webview/index.html`
- Create: `extension/webview/index.tsx`
- Create: `extension/webview/vscode.ts`
- Create: `extension/src/chatPanel.ts` (stub)

**Step 1: Create base HTML**

```html
<!-- extension/webview/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src ${cspNonce}; style-src 'unsafe-inline'; connect-src http://127.0.0.1:*;">
  <title>OpenDuo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${cspNonce}" src="${webviewUri}"></script>
</body>
</html>
```

**Step 2: Create vscode.ts wrapper**

```typescript
// extension/webview/vscode.ts
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
export default vscode;
```

**Step 3: Create index.tsx entry**

```typescript
// extension/webview/index.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './components/ChatApp';

const root = createRoot(document.getElementById('root')!);
root.render(<ChatApp />);
```

**Step 4: Create ChatApp stub**

```typescript
// extension/webview/components/ChatApp.tsx
import React from 'react';

export const ChatApp: React.FC = () => {
  return <div style={{ padding: '1rem' }}>OpenDuo Chat — loading...</div>;
};
```

**Step 5: Build webview**

```bash
cd extension && npm run build 2>&1
```
Expected: `dist/webview.js` created.

**Step 6: Commit**

```bash
cd .. && git add extension/webview/
git commit -m "feat(ui): scaffold webview HTML, React entry, vscode.ts wrapper"
```

---

### Task 20: Webview — useChat Hook (SSE Consumer)

**Files:**
- Create: `extension/webview/hooks/useChat.ts`
- Create: `extension/webview/hooks/useChat.test.ts`

**Step 1: Write failing test**

```typescript
// extension/webview/hooks/useChat.test.ts
import { describe, it, expect } from 'vitest';
import { appendToken, createMessage } from './useChat';

describe('useChat utilities', () => {
  it('creates a user message', () => {
    const msg = createMessage('user', 'hello');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(msg.id).toBeDefined();
  });

  it('appends token to message content', () => {
    const msg = createMessage('assistant', '');
    const updated = appendToken(msg, 'Hello');
    expect(updated.content).toBe('Hello');
  });
});
```

**Step 2: Implement useChat hook**

```typescript
// extension/webview/hooks/useChat.ts
import { useState, useCallback } from 'react';

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  isStreaming?: boolean;
}

export function createMessage(role: MessageRole, content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content };
}

export function appendToken(msg: ChatMessage, token: string): ChatMessage {
  return { ...msg, content: msg.content + token };
}

export function useChat(serverUrl: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (text: string, username: string) => {
    const userMsg = createMessage('user', text);
    const assistantMsg: ChatMessage = { ...createMessage('assistant', ''), isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsLoading(true);

    try {
      const resp = await fetch(`${serverUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, username }),
      });

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            setMessages(prev => prev.map(m =>
              m.id === assistantMsg.id
                ? appendToken(m, data)
                : m
            ));
          }
        }
      }
    } finally {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
      ));
      setIsLoading(false);
    }
  }, [serverUrl]);

  return { messages, isLoading, sendMessage };
}
```

**Step 3: Run tests and commit**

```bash
cd extension && npm test 2>&1
git add extension/webview/hooks/
cd .. && git commit -m "feat(ui): add useChat hook with SSE streaming and message state"
```

---

### Task 21: Webview — React Components

**Files:**
- Create: `extension/webview/components/MessageBubble.tsx`
- Create: `extension/webview/components/InputBar.tsx`
- Create: `extension/webview/components/StatusBar.tsx`
- Create: `extension/webview/components/ChatWindow.tsx`
- Modify: `extension/webview/components/ChatApp.tsx`

**Step 1: MessageBubble**

```typescript
// extension/webview/components/MessageBubble.tsx
import React from 'react';
import type { ChatMessage } from '../hooks/useChat';

interface Props { message: ChatMessage; }

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '0.75rem',
      padding: '0 1rem',
    }}>
      <div style={{
        maxWidth: '80%',
        padding: '0.6rem 0.9rem',
        borderRadius: '8px',
        background: isUser
          ? 'var(--vscode-button-background)'
          : 'var(--vscode-editorWidget-background)',
        color: isUser
          ? 'var(--vscode-button-foreground)'
          : 'var(--vscode-editor-foreground)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.9rem',
        lineHeight: '1.5',
      }}>
        {message.content}
        {message.isStreaming && <span style={{ opacity: 0.5 }}>▋</span>}
      </div>
    </div>
  );
};
```

**Step 2: InputBar**

```typescript
// extension/webview/components/InputBar.tsx
import React, { useState, useRef } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export const InputBar: React.FC<Props> = ({ onSend, disabled }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{
      display: 'flex',
      padding: '0.75rem 1rem',
      gap: '0.5rem',
      borderTop: '1px solid var(--vscode-panel-border)',
    }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Ask GitLab Duo anything... (Enter to send, Shift+Enter for newline)"
        rows={2}
        style={{
          flex: 1,
          resize: 'none',
          padding: '0.5rem',
          background: 'var(--vscode-input-background)',
          color: 'var(--vscode-input-foreground)',
          border: '1px solid var(--vscode-input-border)',
          borderRadius: '4px',
          fontFamily: 'inherit',
          fontSize: '0.9rem',
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        style={{
          padding: '0.5rem 1rem',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
          border: 'none',
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        Send
      </button>
    </div>
  );
};
```

**Step 3: StatusBar**

```typescript
// extension/webview/components/StatusBar.tsx
import React from 'react';

interface Props {
  connected: boolean;
  model?: string;
}

export const StatusBar: React.FC<Props> = ({ connected, model }) => (
  <div style={{
    padding: '0.25rem 1rem',
    fontSize: '0.75rem',
    color: 'var(--vscode-statusBar-foreground)',
    background: 'var(--vscode-statusBar-background)',
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
  }}>
    <span style={{ color: connected ? '#4ec9b0' : '#f44747' }}>
      ● {connected ? 'Connected' : 'Disconnected'}
    </span>
    {model && <span>Model: {model}</span>}
    <span style={{ marginLeft: 'auto', opacity: 0.7 }}>OpenDuo</span>
  </div>
);
```

**Step 4: ChatWindow**

```typescript
// extension/webview/components/ChatWindow.tsx
import React, { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '../hooks/useChat';

interface Props { messages: ChatMessage[]; }

export const ChatWindow: React.FC<Props> = ({ messages }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div style={{
      flex: 1,
      overflowY: 'auto',
      padding: '1rem 0',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {messages.length === 0 && (
        <div style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>
          Ask me anything about your GitLab projects.
        </div>
      )}
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
      <div ref={bottomRef} />
    </div>
  );
};
```

**Step 5: Wire ChatApp**

```typescript
// extension/webview/components/ChatApp.tsx
import React from 'react';
import { ChatWindow } from './ChatWindow';
import { InputBar } from './InputBar';
import { StatusBar } from './StatusBar';
import { useChat } from '../hooks/useChat';

const SERVER_URL = 'http://127.0.0.1:8745';

export const ChatApp: React.FC = () => {
  const { messages, isLoading, sendMessage } = useChat(SERVER_URL);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <StatusBar connected={true} model="claude-sonnet-4-5" />
      <ChatWindow messages={messages} />
      <InputBar onSend={(text) => sendMessage(text, 'user')} disabled={isLoading} />
    </div>
  );
};
```

**Step 6: Build and commit**

```bash
cd extension && npm run build 2>&1
cd .. && git add extension/webview/
git commit -m "feat(ui): implement full React chat UI with streaming, InputBar, StatusBar"
```

---

### Task 22: Extension — Full ChatPanel Integration

**Files:**
- Create: `extension/src/chatPanel.ts` (full implementation)
- Modify: `extension/src/extension.ts`

**Step 1: Implement chatPanel.ts**

```typescript
// extension/src/chatPanel.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { log } from './logger';

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly serverUrl: string;

  private constructor(
    extensionUri: vscode.Uri,
    serverUrl: string,
  ) {
    this.serverUrl = serverUrl;
    this.panel = vscode.window.createWebviewPanel(
      'openduoChat',
      'OpenDuo',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
        ],
      }
    );

    this.panel.webview.html = this.buildHtml(extensionUri);
    this.panel.onDidDispose(() => { ChatPanel.instance = undefined; });
    log(`ChatPanel opened, serverUrl=${serverUrl}`);
  }

  static createOrShow(extensionUri: vscode.Uri, serverUrl: string): void {
    if (ChatPanel.instance) {
      ChatPanel.instance.panel.reveal();
      return;
    }
    ChatPanel.instance = new ChatPanel(extensionUri, serverUrl);
  }

  private buildHtml(extensionUri: vscode.Uri): string {
    const nonce = this.getNonce();
    const webviewUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js')
    );
    const htmlPath = path.join(extensionUri.fsPath, 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    html = html.replace(/\$\{cspNonce\}/g, nonce);
    html = html.replace('${webviewUri}', webviewUri.toString());
    return html;
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
```

**Step 2: Update openChat command in extension.ts**

Replace the placeholder `vscode.window.showInformationMessage(...)` line in `openChat` with:

```typescript
ChatPanel.createOrShow(context.extensionUri, serverManager.serverUrl());
```

**Step 3: Build and commit**

```bash
cd extension && npm run build 2>&1
cd .. && git add extension/src/chatPanel.ts extension/src/extension.ts
git commit -m "feat(extension): add ChatPanel with full webview integration"
```

---

## Phase 5 — Hardening

### Task 23: FIPS TLS — native-tls Audit

**Files:**
- Modify: `crates/openduo-core/Cargo.toml`
- Modify: `crates/openduo-agent/Cargo.toml`

**Step 1: Verify native-tls is the only TLS backend**

```bash
cargo tree -p openduo-core | grep -E "tls|ssl" 2>&1
cargo tree -p openduo-agent | grep -E "tls|ssl" 2>&1
```
Expected: only `native-tls` appears, NOT `rustls`.

**Step 2: Add explicit feature guard to prevent rustls**

```toml
# In workspace Cargo.toml, under [workspace.dependencies]:
reqwest = { version = "0.12", default-features = false, features = ["native-tls", "json", "stream"] }
```
The `default-features = false` ensures rustls is never pulled in.

**Step 3: Verify**

```bash
cargo build --workspace 2>&1 | grep -i tls
```
Expected: no rustls references.

**Step 4: Commit**

```bash
git add Cargo.toml
git commit -m "security: enforce native-tls (FIPS-validated SChannel) across workspace"
```

---

### Task 24: Input Validation

**Files:**
- Create: `crates/openduo-server/src/validation.rs`
- Modify: `crates/openduo-server/src/routes.rs`

**Step 1: Write failing test**

```rust
// crates/openduo-server/src/validation.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_empty_message() {
        assert!(validate_chat_request("").is_err());
    }

    #[test]
    fn test_rejects_overlong_message() {
        let long = "x".repeat(10_001);
        assert!(validate_chat_request(&long).is_err());
    }

    #[test]
    fn test_accepts_valid_message() {
        assert!(validate_chat_request("List my open issues").is_ok());
    }
}
```

**Step 2: Implement validation**

```rust
// crates/openduo-server/src/validation.rs
use anyhow::{anyhow, Result};

pub fn validate_chat_request(message: &str) -> Result<()> {
    if message.trim().is_empty() {
        return Err(anyhow!("Message cannot be empty"));
    }
    if message.len() > 10_000 {
        return Err(anyhow!("Message exceeds maximum length of 10,000 characters"));
    }
    Ok(())
}
```

**Step 3: Apply validation in chat_handler**

```rust
// Add at top of chat_handler in routes.rs:
use crate::validation::validate_chat_request;

// In chat_handler, before spawning tokio task:
if let Err(e) = validate_chat_request(&req.message) {
    // Return error SSE event
}
```

**Step 4: Run tests and commit**

```bash
cargo test -p openduo-server 2>&1
git add crates/openduo-server/src/validation.rs crates/openduo-server/src/routes.rs
git commit -m "security: add input validation - max 10k chars, no empty messages"
```

---

### Task 25: Audit Logging

**Files:**
- Modify: `crates/openduo-tools/src/registry.rs`

**Step 1: Add tracing instrument to all tool executions**

In `ToolRegistry::execute`, wrap the call with a tracing span:

```rust
pub async fn execute(&self, name: &str, args: serde_json::Value) -> Result<String> {
    let span = tracing::info_span!("tool_execute", tool_name = %name);
    let _enter = span.enter();
    tracing::info!(tool = %name, args = %args, "Tool invocation");
    match self.tools.get(name) {
        Some(tool) => {
            let result = tool.execute(args).await;
            match &result {
                Ok(r) => tracing::info!(tool = %name, result_len = r.len(), "Tool success"),
                Err(e) => tracing::error!(tool = %name, error = %e, "Tool failed"),
            }
            result
        }
        None => anyhow::bail!("Unknown tool: {}", name),
    }
}
```

**Step 2: Verify logs appear in output**

```bash
RUST_LOG=info GITLAB_URL=https://example.com GITLAB_PAT=test ./target/debug/openduo-server.exe 2>&1 &
```
Expected: structured JSON logs with `tool_name` field.

**Step 3: Commit**

```bash
git add crates/openduo-tools/src/registry.rs
git commit -m "security: add structured audit logging for all tool invocations"
```

---

### Task 26: CSP Lockdown + Security Audit

**Step 1: Verify CSP in index.html restricts correctly**

The CSP header must be:
```
default-src 'none';
script-src 'nonce-{random}';
style-src 'unsafe-inline';
connect-src http://127.0.0.1:*;
```
No `'unsafe-eval'`, no external domains, no wildcard `*`.

**Step 2: Run cargo audit**

```bash
cargo audit 2>&1
```
Expected: no vulnerabilities with CVSS >= 7.0. Fix any that appear with `cargo update`.

**Step 3: Run npm audit**

```bash
cd extension && npm audit --audit-level=high 2>&1
```
Expected: no high or critical vulnerabilities.

**Step 4: Commit**

```bash
cd .. && git add .
git commit -m "security: CSP lockdown, cargo audit + npm audit clean"
```

---

## Phase 6 — Release Pipeline

### Task 27: GitLab CI — Full Pipeline

**Files:**
- Create: `.gitlab-ci.yml`

**Step 1: Write the pipeline**

```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - package
  - release

variables:
  CARGO_HOME: "${CI_PROJECT_DIR}/.cargo"
  RUST_VERSION: "stable"

# ── TEST ──────────────────────────────────────────────────────────

rust:fmt:
  stage: test
  image: "rust:${RUST_VERSION}"
  script:
    - rustup component add rustfmt
    - cargo fmt --all -- --check
  cache:
    key: rust-cache
    paths: [.cargo/]

rust:clippy:
  stage: test
  image: "rust:${RUST_VERSION}"
  script:
    - rustup component add clippy
    - cargo clippy --workspace -- -D warnings
  cache:
    key: rust-cache
    paths: [.cargo/, target/]

rust:test:
  stage: test
  image: "rust:${RUST_VERSION}"
  script:
    - cargo test --workspace
  cache:
    key: rust-cache
    paths: [.cargo/, target/]

rust:audit:
  stage: test
  image: "rust:${RUST_VERSION}"
  script:
    - cargo install cargo-audit
    - cargo audit
  cache:
    key: rust-cache
    paths: [.cargo/]
  allow_failure: false

ts:test:
  stage: test
  image: node:20
  script:
    - cd extension
    - npm ci
    - npm test
  cache:
    key: node-cache
    paths: [extension/node_modules/]

ts:lint:
  stage: test
  image: node:20
  script:
    - cd extension
    - npm ci
    - npx tsc --noEmit
  cache:
    key: node-cache
    paths: [extension/node_modules/]

ts:audit:
  stage: test
  image: node:20
  script:
    - cd extension
    - npm ci
    - npm audit --audit-level=high
  cache:
    key: node-cache
    paths: [extension/node_modules/]

# ── BUILD ─────────────────────────────────────────────────────────

rust:build:windows:
  stage: build
  image: "rust:${RUST_VERSION}"
  before_script:
    - apt-get update && apt-get install -y mingw-w64
    - rustup target add x86_64-pc-windows-gnu
  script:
    - cargo build --release --target x86_64-pc-windows-gnu -p openduo-server
  artifacts:
    paths:
      - target/x86_64-pc-windows-gnu/release/openduo-server.exe
    expire_in: 1 hour
  cache:
    key: rust-windows-cache
    paths: [.cargo/, target/]

ts:build:
  stage: build
  image: node:20
  script:
    - cd extension
    - npm ci
    - npm run build
  artifacts:
    paths:
      - extension/dist/
    expire_in: 1 hour
  cache:
    key: node-cache
    paths: [extension/node_modules/]

# ── PACKAGE ───────────────────────────────────────────────────────

vsix:package:
  stage: package
  image: node:20
  needs:
    - rust:build:windows
    - ts:build
  script:
    - mkdir -p extension/bin
    - cp target/x86_64-pc-windows-gnu/release/openduo-server.exe extension/bin/
    - cd extension
    - npm ci
    - npx vsce package --out openduo-windows-x64-${CI_COMMIT_TAG:-dev}.vsix
  artifacts:
    paths:
      - extension/openduo-windows-x64-*.vsix
    expire_in: 7 days
  cache:
    key: node-cache
    paths: [extension/node_modules/]

# ── RELEASE ───────────────────────────────────────────────────────

gitlab:release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  needs:
    - vsix:package
  rules:
    - if: '$CI_COMMIT_TAG =~ /^v[0-9]+\.[0-9]+\.[0-9]+$/'
  script:
    - echo "Creating GitLab Release for ${CI_COMMIT_TAG}"
  release:
    name: "OpenDuo ${CI_COMMIT_TAG}"
    description: "OpenDuo VS Code Extension — Windows x64"
    tag_name: "${CI_COMMIT_TAG}"
    assets:
      links:
        - name: "openduo-windows-x64-${CI_COMMIT_TAG}.vsix"
          url: "${CI_PROJECT_URL}/-/jobs/artifacts/${CI_COMMIT_TAG}/raw/extension/openduo-windows-x64-${CI_COMMIT_TAG}.vsix?job=vsix:package"
          link_type: package
```

**Step 2: Commit the pipeline**

```bash
git add .gitlab-ci.yml
git commit -m "ci: add full 4-stage GitLab CI pipeline with release automation"
```

---

### Task 28: README — Install Guide

**Files:**
- Modify: `README.md`

**Step 1: Replace README with project documentation**

```markdown
# OpenDuo

GitLab Duo Agentic Chat for Federal Enterprise environments.
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
   Example: `https://gitlab.example.gov`
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
```

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add install guide, configuration, and usage documentation"
```

---

### Task 29: Tag v0.1.0 and Verify Pipeline

**Step 1: Run full local test suite**

```bash
cargo test --workspace 2>&1 && cd extension && npm test 2>&1
```
Expected: all tests pass.

**Step 2: Build release binary locally**

```bash
cargo build --release -p openduo-server 2>&1
```

**Step 3: Package vsix locally**

```bash
cp target/release/openduo-server.exe extension/bin/
cd extension && npx vsce package 2>&1
```
Expected: `openduo-0.1.0.vsix` created.

**Step 4: Push branch and open Merge Request (do NOT tag yet)**

```bash
git push origin HEAD
```
Then open MR on GitLab for review.

**Step 5: After MR is merged, tag from main**

```bash
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```
Expected: CI pipeline triggers, vsix artifact created, GitLab Release published.

---

## Summary

| Phase | Tasks | Key Outcome |
|---|---|---|
| 1 — Foundation | 1–10 | Rust workspace, PAT auth, /health, extension scaffold |
| 2 — Agent Engine | 11–15 | ReAct loop, GitLab AI Gateway SSE, end-to-end text chat |
| 3 — Tool Engine | 16–18 | 30+ GitLab tools, full agentic chat |
| 4 — React Chat UI | 19–22 | Streaming chat UI, MessageBubble, InputBar, StatusBar |
| 5 — Hardening | 23–26 | FIPS TLS, input validation, audit logging, CSP, audits |
| 6 — Release Pipeline | 27–29 | GitLab CI, vsix packaging, Release automation, README |
