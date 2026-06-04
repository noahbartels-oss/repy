// Availability check for a single online ID via PSN universal search.
import { makeUniversalSearch } from "psn-api";

/**
 * Returns "available", "taken", or "error" for a given online ID.
 *
 * Universal search may return fuzzy matches, so we only consider a name
 * taken when some result's onlineId matches exactly (case-insensitive).
 *
 * NOTE: "available" means no public profile exists. PSN may still reserve,
 * hold (recently deleted), or ban a name, so it is a strong hint, not a
 * guarantee that the name can actually be claimed.
 */
export async function checkAvailability(authorization, name) {
  const response = await makeUniversalSearch(authorization, name, "SocialAllAccounts");
  const wanted = name.toLowerCase();

  for (const domain of response.domainResponses ?? []) {
    for (const result of domain.results ?? []) {
      const onlineId = result?.socialMetadata?.onlineId;
      if (onlineId && onlineId.toLowerCase() === wanted) {
        return "taken";
      }
    }
  }
  return "available";
}
