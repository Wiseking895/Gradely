import type { SchoolOverview } from '../../lib/api.ts'

export type SchoolOutletContext = {
  schoolId: string
  overview: SchoolOverview
  canManage: boolean
  isPlatformAdmin: boolean
  refresh: () => Promise<void>
}
