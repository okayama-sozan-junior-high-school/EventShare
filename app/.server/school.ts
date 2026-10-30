/**
 * School affiliation policy.
 *
 * The verification method is intentionally pluggable: today only the email
 * domain is checked (SIGNUP_MODE=domain). A future "verified school email"
 * flow can set `user.schoolVerifiedAt` after email verification without
 * changing callers, which only rely on `isSchoolEmail` / `schoolVerifiedAt`.
 */
export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  return at === -1 ? "" : email.slice(at + 1).toLowerCase();
}

export function isSchoolEmail(email: string, domains: readonly string[]) {
  const domain = emailDomain(email);
  if (!domain) return false;
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function canSignUp(
  email: string,
  mode: "open" | "domain",
  domains: readonly string[],
) {
  if (mode === "open") return true;
  return domains.length > 0 && isSchoolEmail(email, domains);
}
