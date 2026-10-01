"use server";

import { getMyStaffChildren } from "@/lib/hr/my-profile";

/**
 * The client entry point for My Profile's child lists. It takes NO id: the
 * record is always the caller's own, resolved on the server (`my-profile.ts`),
 * so a browser cannot ask for anyone else's family or bank details through it.
 * Empty lists when the login has no staff record — the page has already said so.
 */
export async function loadMyStaffChildren() {
  const c = await getMyStaffChildren();
  return (
    c ?? {
      family: [],
      experience: [],
      internalRefs: [],
      nominations: [],
      bankAccounts: [],
      externalRefs: [],
      emergencyContacts: [],
      shifts: [],
      education: [],
      technical: [],
      languages: [],
    }
  );
}
