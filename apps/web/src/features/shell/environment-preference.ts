export const environmentCookie = (workspace: string) =>
  `nodrail.environment.${workspace}`;

export function rememberEnvironment(workspace: string, environment: string) {
  document.cookie = `${environmentCookie(workspace)}=${environment}; path=/; samesite=lax`;
}

export function browserEnvironment(workspace: string) {
  const key = `${environmentCookie(workspace)}=`;
  return document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(key))
    ?.slice(key.length);
}
