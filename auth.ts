import { buildAuthConfig, createAuth } from "@qavren/auth-next";
import type { Session } from "next-auth";
import { env } from "@/lib/env";

export const REALM = env.realm;

const base = buildAuthConfig({ realm: REALM });
const baseJwt = base.callbacks?.jwt;
const baseSession = base.callbacks?.session;

export const { handlers, auth, signIn, signOut } = createAuth({
  realm: REALM,
  pages: { signIn: "/sign-in" },
  callbacks: {
    async jwt(params) {
      const token = (baseJwt ? await baseJwt(params) : null) ?? params.token;
      if (params.profile && typeof params.profile.sub === "string") token.sub = params.profile.sub;
      return token;
    },
    async session(params) {
      const session = (baseSession ? await baseSession(params) : params.session) as Session;
      if (params.token.sub) session.user.id = params.token.sub;
      return session;
    }
  }
});
