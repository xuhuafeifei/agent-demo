import path from "node:path";
import { resolveTenantLaneDir } from "../utils/app-path.js";

export function resolveLaneIndexPath(tenantId: string): string {
  return path.join(resolveTenantLaneDir(tenantId), "lane.json");
}
