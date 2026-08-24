import { getDatabase } from '../db/database';
import { AppError } from '../api/middleware/error.middleware';

// Every route that reads/writes org-scoped data (scans, findings, tagging,
// inventory, etc.) must call this after extracting orgId and before touching
// anything else — org_id is the root of tenancy, so this is the single
// checkpoint that keeps one user's Datadog org connections and scan history
// invisible to every other user. 404 (not 403) so ownership isn't leaked by
// the error itself — a user probing a real-but-not-theirs org id sees the
// same response as one probing a nonexistent id.
export async function assertOrgAccess(orgId: string, userId: string): Promise<void> {
  const db = getDatabase();
  const org = await db<{ id: string; created_by_user_id: string | null }>('orgs')
    .select('id', 'created_by_user_id')
    .where({ id: orgId })
    .first();

  if (!org || org.created_by_user_id !== userId) {
    throw new AppError('Organization not found', 404);
  }
}
