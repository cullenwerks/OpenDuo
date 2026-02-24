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
