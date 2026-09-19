/** Team roles shared between client and server code. */
export type TeamRole = "Tank" | "Healer" | "DPS" | "Support" | "Leader";

export const TEAM_ROLES: TeamRole[] = ["Tank", "Healer", "DPS", "Support", "Leader"];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as string[]).includes(value);
}
