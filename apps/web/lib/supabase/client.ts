import { createClient } from "@supabase/supabase-js";

// No user auth/session in this app — every query is an anonymous read against
// `gemstone_sales`, so a single anon-key client is all we need. (No
// @supabase/ssr cookie-syncing client, since there's no login flow to keep in
// sync between server and browser.)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set in .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
