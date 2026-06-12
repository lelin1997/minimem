// ============================================================
// MiniMem — Owner Profile 模块（统一导出）
// ============================================================

export {
  setProfileEntry,
  getProfileEntry,
  getProfileByCategory,
  getFullProfile,
  getProfileByPrefix,
  deleteProfileEntry,
  setProfileEntries,
  listProfileCategories,
  countProfileEntries,
} from './profile.js';

export {
  recordPreference,
  getPreference,
  getAllPreferences,
  getStrongPreferences,
  deletePreference,
} from './preferences.js';
export type { Preference } from './preferences.js';

export {
  createPerson,
  getPersonById,
  findPersonByName,
  updatePerson,
  appendPersonInfo,
  listPersons,
  touchPerson,
  deletePerson,
  countPersons,
} from './persons.js';
