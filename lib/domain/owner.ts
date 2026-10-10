export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
export function isOwner(user: { email: string | null | undefined; roles: string[] }, ownerEmails: string[]): boolean {
  if (user.roles.includes("owner")) return true;
  return !!user.email && ownerEmails.includes(user.email.toLowerCase());
}
