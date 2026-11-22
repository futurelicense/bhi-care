import { ROLES, type Role } from "./domain/types.ts";

export const DEMO_ACCESS_CODE = "care-demo";

export function openWorkspaceSession(input: {
  name: string;
  role: string;
  accessCode: string;
}): { ok: true; name: string; role: Role } | { ok: false; message: string } {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 40) {
    return { ok: false, message: "Enter the name to show on this workspace." };
  }
  if (!ROLES.includes(input.role as Role)) {
    return { ok: false, message: "Choose a workspace role." };
  }
  if (input.accessCode.trim() !== DEMO_ACCESS_CODE) {
    return { ok: false, message: "Access code was not recognized." };
  }
  return { ok: true, name, role: input.role as Role };
}
