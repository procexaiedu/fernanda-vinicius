export type UserRole = 'admin' | 'operator'

export interface UserProfile {
  id: string
  full_name: string
  role: UserRole
  store_id: string | null
  is_active: boolean
}

export interface Store {
  id: string
  name: string
  city: string
  state: string
  address: string | null
  phone: string | null
  cnpj: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SessionContext {
  user: UserProfile
  activeStoreId: string | null
}
