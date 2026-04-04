import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export function createSupabaseBrowserClient() {
  if (!env.supabaseConfigured) {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
