import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeUser = { id?: string; email?: string | null; name?: string | null; roles?: string[] };
let fakeUser: FakeUser | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => (fakeUser ? { user: fakeUser } : null) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  }
}));
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return { ...actual, cache: <T,>(fn: T) => fn };
});

async function load() {
  vi.resetModules();
  vi.stubEnv("KAIRIS_OWNER_EMAILS", "boss@example.com");
  return import("@/lib/server/session");
}

beforeEach(() => {
  fakeUser = null;
});

describe("session helpers", () => {
  it("currentUser is null without a session or id", async () => {
    const { currentUser } = await load();
    expect(await currentUser()).toBeNull();
    fakeUser = { email: "a@b.c" };
    expect(await currentUser()).toBeNull();
  });

  it("maps fields and flags owner by email", async () => {
    const { currentUser } = await load();
    fakeUser = { id: "u1", email: "Boss@Example.com", name: "Boss", roles: ["trader"] };
    expect(await currentUser()).toEqual({ id: "u1", email: "Boss@Example.com", name: "Boss", roles: ["trader"], isOwner: true });
  });

  it("flags owner by role and defaults missing fields", async () => {
    const { currentUser } = await load();
    fakeUser = { id: "u2", roles: ["owner"] };
    expect(await currentUser()).toEqual({ id: "u2", email: null, name: null, roles: ["owner"], isOwner: true });
  });

  it("requireUser redirects when signed out", async () => {
    const { requireUser } = await load();
    await expect(requireUser("/app/x")).rejects.toThrow("REDIRECT:/sign-in?callbackUrl=%2Fapp%2Fx");
  });

  it("requireOwner 404s for non-owner and passes owner", async () => {
    const { requireOwner } = await load();
    fakeUser = { id: "u3", email: "other@example.com", roles: [] };
    await expect(requireOwner("/app")).rejects.toThrow("NOT_FOUND");
    fakeUser = { id: "u4", email: "boss@example.com", roles: [] };
    expect((await requireOwner("/app")).id).toBe("u4");
  });
});
