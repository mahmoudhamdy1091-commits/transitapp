// ╔══════════════════════════════════════════════════════════╗
// ║  permissions.js — Roles & Capability Checks              ║
// ║  Transit Management System                               ║
// ╚══════════════════════════════════════════════════════════╝
// نُقلت من utils.js (Phase 1). لا تبعيات تحميل — تُحمَّل مبكراً
// (بعد core.js) لأن can() يُستخدم في كل الملفات وقت التشغيل،
// و_currentRole يُكتب من settings.js (loadUserRoleFromDB).

// ════════════════════════════════════════
// ROLES & PERMISSIONS
// ════════════════════════════════════════
export const ROLES = {
  admin:    { label:'👑 مدير',   color:'var(--accent)',  bg:'var(--accent-dim)',  edit:true,  delete:true,  transactions:true,  approve:true,  settings:true,  roles:true  },
  employee: { label:'👤 موظف',   color:'var(--blue)',    bg:'var(--blue-dim)',    edit:true,  delete:false, transactions:true,  approve:false, settings:false, roles:false },
  readonly: { label:'👁 مشاهدة', color:'var(--text2)',   bg:'var(--card2)',       edit:false, delete:false, transactions:false, approve:false, settings:false, roles:false },
};

// افتراضي: readonly (الأكثر أماناً) حتى تُحمَّل الصلاحية من DB
let _currentRole = localStorage.getItem('tm_role') || 'readonly';
export function getCurrentRole() { return _currentRole; }
export function setCurrentRole(role) { _currentRole = role; }

export function can(action) { return ROLES[_currentRole]?.[action] === true; }

Object.assign(window, { ROLES, getCurrentRole, setCurrentRole, can });
