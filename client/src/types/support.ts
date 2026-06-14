export interface SupportMsg {
  id: number
  user_id?: number
  sender: 'user' | 'admin'
  message: string
  created_at: string
  read_by_admin?: number
  read_by_user?: number
}
