import { execFile as execFileCb } from 'child_process';

/**
 * Extracts the GitLab project path (e.g. "group/project") from the git
 * remote origin URL of a workspace folder.
 *
 * Returns null if the remote doesn't point at the configured GitLab instance
 * or if the git command fails.
 */
export async function extractProjectPath(
  workspacePath: string,
  gitlabUrl: string,
): Promise<string | null> {
  let remoteUrl: string;
  try {
    remoteUrl = await getRemoteUrl(workspacePath);
  } catch {
    return null;
  }

  remoteUrl = remoteUrl.trim();
  const host = new URL(gitlabUrl.replace(/\/+$/, '')).hostname;

  // HTTPS: https://gitlab.com/group/project.git
  try {
    const parsed = new URL(remoteUrl);
    if (parsed.hostname === host) {
      return parsed.pathname.replace(/^\//, '').replace(/\.git$/, '') || null;
    }
  } catch {
    // Not a valid URL — try SSH format
  }

  // SSH: git@gitlab.com:group/project.git
  const sshMatch = remoteUrl.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch && sshMatch[1] === host) {
    return sshMatch[2].replace(/\.git$/, '') || null;
  }

  return null;
}

function getRemoteUrl(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileCb('git', ['remote', 'get-url', 'origin'], { cwd }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}
