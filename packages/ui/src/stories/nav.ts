import { Activity, Bot, FileText, Inbox, ListTodo } from 'lucide-react'
import type { GroupNav, NavItem } from '../shell/Sidebar.tsx'

/** A plausible Box's nav, for the shell stories. Four groups, one of them active. */
export const SAMPLE_GROUP_NAV: Omit<GroupNav, 'onSelectGroup'> = {
  groups: [
    { id: 'signals', label: 'Signals', icon: Activity },
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'planning', label: 'Planning', icon: ListTodo },
    { id: 'automation', label: 'Automation', icon: Bot },
  ],
  activeGroup: 'signals',
}

/** Two sections, contiguous, so the section headings actually draw. */
export const SAMPLE_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: Activity, section: 'All' },
  { id: 'github', label: 'GitHub', icon: FileText, section: 'Channels', count: 23 },
  { id: 'npm', label: 'npm', icon: FileText, section: 'Channels', count: 15 },
  { id: 'reddit', label: 'Reddit', icon: FileText, section: 'Channels', count: 7 },
  { id: 'content', label: 'Content', icon: FileText, section: 'Channels', badge: '1/3' },
]
