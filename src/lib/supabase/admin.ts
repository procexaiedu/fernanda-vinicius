import { createClient } from '@supabase/supabase-js'

// Bypassa RLS — usar APENAS no server-side (Server Actions, Route Handlers)
// NUNCA expor no client-side
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'fv' } }
  )
}
