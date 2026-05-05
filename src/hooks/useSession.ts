'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/types'

export function useSession() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()

    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('users')
        .select('id, full_name, role, store_id, is_active')
        .eq('id', user.id)
        .single()

      setProfile(data as UserProfile | null)
      setLoading(false)
    }

    load()
  }, [])

  return { profile, loading }
}
