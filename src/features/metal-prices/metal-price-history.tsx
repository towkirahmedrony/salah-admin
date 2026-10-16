import { Badge, TableEmptyRow, TableShell } from "@/components/ui/data";
import { SectionCard } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { SYNC_HISTORY_LIMIT } from "@/features/metal-prices/constants";
import type { MetalPriceSyncLogRow } from "@/lib/types/database";
import {
  METAL_PRICE_METAL_STATUS_LABELS,
  METAL_PRICE_SYNC_STATUS_LABELS,
  formatDateTime,
} from "@/lib/utils/format";

/**
 * Recent synchronization attempts.
 *
 * The log says what was attempted and what came of it, per metal, so a partial
 * failure is legible without reading the price records. It is administrator-only:
 * the table is never reachable from the public read the Android app uses.
 *
 * The counts are deliberately not presented as a success score — a run can fetch
 * nothing new because nothing changed, which is not a fault.
 */
export function MetalPriceHistory({ logs }: { logs: MetalPriceSyncLogRow[] }) {
  return (
    <SectionCard
      title="Synchronization history"
      description={`The last ${SYNC_HISTORY_LIMIT} attempts. A run that was interrupted is closed automatically rather than left showing as running.`}
    >
      <TableShell
        caption="Recent reference-price synchronization attempts"
        columns={["Started", "Status", "Gold", "Silver", "Candidates", "Overrides", "Details"]}
      >
        {logs.length === 0 ? (
          <TableEmptyRow colSpan={7}>
            <EmptyState
              title="No synchronization has run yet"
              description="Fetching prices from the provider records an entry here, whether it succeeds or fails."
            />
          </TableEmptyRow>
        ) : (
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <th scope="row" className="text-left font-medium text-ink-900">
                  <span className="block whitespace-nowrap">{formatDateTime(log.started_at)}</span>
                  <span className="text-xs font-normal text-ink-500">
                    {log.completed_at ? `finished ${formatDateTime(log.completed_at)}` : "still running"}
                  </span>
                </th>

                <td>
                  <Badge
                    tone={
                      log.status === "succeeded" ? "brand" : log.status === "partial" ? "amber" : log.status === "failed" ? "red" : "slate"
                    }
                  >
                    {METAL_PRICE_SYNC_STATUS_LABELS[log.status]}
                  </Badge>
                </td>

                <td className="text-xs">{metalStatus(log.gold_status)}</td>
                <td className="text-xs">{metalStatus(log.silver_status)}</td>

                <td className="whitespace-nowrap text-xs text-ink-700">
                  {log.gold_candidates} gold · {log.silver_candidates} silver
                  <span className="block text-ink-500">
                    {log.pending_candidates} pending · {log.rejected_candidates} refused
                  </span>
                </td>

                <td className="text-xs text-ink-700">
                  {log.overrides_preserved > 0 ? (
                    <span className="font-medium text-amber-800">{log.overrides_preserved} preserved</span>
                  ) : (
                    <span className="text-ink-400">None active</span>
                  )}
                </td>

                <td className="max-w-[18rem] text-xs">
                  <span className="break-words text-ink-600">
                    {log.error_message ?? (log.status === "running" ? "Waiting for the result." : "No problems recorded.")}
                  </span>
                  <span className="mt-1 block text-ink-400">Source: {log.provider}</span>
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </TableShell>
    </SectionCard>
  );
}

function metalStatus(status: MetalPriceSyncLogRow["gold_status"]): string {
  if (!status) return "—";
  return METAL_PRICE_METAL_STATUS_LABELS[status];
}
