import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Anonymous (public) client: it can only read the published catalog view and call the
// public order functions. Costs, other customers and internal tables are blocked by the database.
export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "متجر الموبايلات";
