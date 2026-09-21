/**
 * Albion build/role catalog + mass sheet builder primitives shared by the
 * admin wizard and edit mode. Nothing is hardcoded as required — admins can
 * always type a custom value (§10).
 */
export const ALBION_ROLES = [
  "Tank", "DPS", "Healer", "Support", "Judi", "Demon", "Cleanse", "Fill", "Scout", "Other",
] as const;

export const ALBION_BUILDS = [
  "HvyMace (Guardian)", "BMS (Guardian)", "HOJ (Knight)", "1H-Mace", "Realm",
  "Spirithunter", "Carving", "Hallowfall", "Fallen", "Blight", "Rootbound",
  "Perma", "Chariot", "Bastion", "Great Arcane", "1H-Arcane",
] as const;

export const TIMEZONES = [
  "UTC", "Europe/London", "Europe/Berlin", "Europe/Paris", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo",
  "Asia/Tokyo", "Asia/Manila", "Asia/Singapore", "Australia/Sydney",
] as const;

export const FILL_NOTES = [
  "Fill Party 1 first", "Fill Party 2 first", "Fill Party 1 and 2 first",
  "Priority tanks", "Reserve party", "FILL 1st and 2nd PT First",
] as const;
