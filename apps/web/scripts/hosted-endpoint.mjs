/** @param {URL} endpoint @param {string} login @param {string} password @param {string} suffix */
export function loginConnectionUrl(endpoint, login, password, suffix = "") {
  if (suffix && !/^[a-z0-9_-]+$/i.test(suffix))
    throw new Error("DATABASE_LOGIN_USER_SUFFIX must be a plain suffix");
  const url = new URL(endpoint);
  url.username = suffix ? `${login}.${suffix}` : login;
  url.password = password;
  return url.href;
}
