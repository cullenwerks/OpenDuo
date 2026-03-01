/** Headers for GitLab REST API calls (PRIVATE-TOKEN). */
export function privateTokenHeaders(pat: string): Record<string, string> {
  return {
    'private-token': pat,
    'content-type': 'application/json',
  };
}

/** Headers for GitLab Duo Chat API (Authorization: Bearer). */
export function bearerHeaders(pat: string): Record<string, string> {
  return {
    authorization: `Bearer ${pat}`,
    'content-type': 'application/json',
  };
}
