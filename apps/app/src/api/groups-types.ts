export interface Group {
  id: string
  orgId: string
  name: string
  slug: string
  createdAt: string
}

export interface GroupMember {
  groupId: string
  userId: string
  orgId: string
  createdAt: string
}
