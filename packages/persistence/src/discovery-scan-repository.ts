import type { DiscoverySource } from "../../contracts/src/discovery.js";
import { type ScanRead, scanReadSchema } from "../../contracts/src/discovery-scan.js";
import { DomainError } from "../../contracts/src/index.js";
import { digest } from "../../discovery/src/normalize.js";
import { DiscoveryRepository } from "./discovery-repository.js";

const cacheVersion = 1;
export class DiscoveryScanRepository extends DiscoveryRepository {
  async loadScan(source: DiscoverySource): Promise<ScanRead[]> {
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.held(tx, source);
      // Prune only this owner's expired public-read caches, never listing evidence.
      for (const expired of await tx.query(
        "SELECT source_id FROM discovery_scans WHERE owner_id=$1 AND expires_at <= $2",
        [this.ownerId, this.now()],
      ))
        await this.clearScan(tx, String(expired.source_id));
      const header = (
        await tx.query("SELECT * FROM discovery_scans WHERE owner_id=$1 AND source_id=$2", [
          this.ownerId,
          source.id,
        ])
      )[0];
      if (
        header &&
        (Number(header.revision) !== source.revision ||
          Number(header.cache_version) !== cacheVersion)
      )
        await this.clearScan(tx, source.id);
      await tx.query(
        "INSERT INTO discovery_scans(owner_id,source_id,revision,cache_version,expires_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,source_id) DO NOTHING",
        [
          this.ownerId,
          source.id,
          source.revision,
          cacheVersion,
          new Date(this.clock().getTime() + 1800000).toISOString(),
        ],
      );
      const reads: ScanRead[] = [];
      for (const row of await tx.query(
        "SELECT * FROM discovery_scan_reads WHERE owner_id=$1 AND source_id=$2 ORDER BY ordinal",
        [this.ownerId, source.id],
      )) {
        let raw: unknown;
        try {
          raw = JSON.parse(String(row.data));
        } catch {
          throw new DomainError("STATE_INVALID", "Public scan cache integrity failed.");
        }
        const parsed = scanReadSchema.safeParse(raw);
        if (
          !parsed.success ||
          Number(row.ordinal) !== reads.length ||
          digest(String(row.data)) !== row.sha256 ||
          Buffer.byteLength(String(row.data)) !== Number(row.bytes) ||
          !Number.isFinite(Date.parse(String(row.verified_at))) ||
          Date.parse(String(row.verified_at)) > this.clock().getTime() ||
          Date.parse(parsed.data.response.fetchedAt) > this.clock().getTime()
        )
          throw new DomainError("STATE_INVALID", "Public scan cache integrity failed.");
        reads.push({ ...parsed.data, verifiedAt: String(row.verified_at) });
      }
      return reads;
    });
  }
  async saveScanRead(source: DiscoverySource, read: ScanRead) {
    const { verifiedAt, ...record } = read;
    const data = JSON.stringify(scanReadSchema.parse(record));
    const bytes = Buffer.byteLength(data);
    if (
      !Number.isFinite(Date.parse(verifiedAt)) ||
      Date.parse(verifiedAt) > this.clock().getTime() ||
      Date.parse(read.response.fetchedAt) > this.clock().getTime()
    )
      throw new DomainError("CONFIG_INVALID", "Invalid scan verification timestamp.");
    return this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.held(tx, source);
      const header = (
        await tx.query("SELECT * FROM discovery_scans WHERE owner_id=$1 AND source_id=$2", [
          this.ownerId,
          source.id,
        ])
      )[0];
      if (
        !header ||
        Number(header.revision) !== source.revision ||
        String(header.expires_at) <= this.now()
      )
        throw new DomainError("LEASE_STALE", "Public scan generation expired.");
      const previous = (
        await tx.query(
          "SELECT bytes FROM discovery_scan_reads WHERE owner_id=$1 AND source_id=$2 AND ordinal=$3",
          [this.ownerId, source.id, read.ordinal],
        )
      )[0];
      const length = Number(
        (
          await tx.query(
            "SELECT COUNT(*) AS total FROM discovery_scan_reads WHERE owner_id=$1 AND source_id=$2",
            [this.ownerId, source.id],
          )
        )[0]?.total,
      );
      if (!previous && read.ordinal !== length)
        throw new DomainError("CONFIG_INVALID", "Public scan reads must be contiguous.");
      const sourceBytes = Number(
        (
          await tx.query(
            "SELECT COALESCE(SUM(bytes),0) AS total FROM discovery_scan_reads WHERE owner_id=$1 AND source_id=$2",
            [this.ownerId, source.id],
          )
        )[0]?.total,
      );
      const ownerBytes = Number(
        (
          await tx.query(
            "SELECT COALESCE(SUM(bytes),0) AS total FROM discovery_scan_reads WHERE owner_id=$1",
            [this.ownerId],
          )
        )[0]?.total,
      );
      const delta = bytes - Number(previous?.bytes ?? 0);
      if (sourceBytes + delta > 32 * 1024 * 1024 || ownerBytes + delta > 128 * 1024 * 1024)
        throw new DomainError("CONFIG_INVALID", "Public scan cache storage bound exceeded.");
      await tx.query(
        "INSERT INTO discovery_scan_reads(owner_id,source_id,ordinal,data,sha256,bytes,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,source_id,ordinal) DO UPDATE SET data=excluded.data,sha256=excluded.sha256,bytes=excluded.bytes,verified_at=excluded.verified_at",
        [this.ownerId, source.id, read.ordinal, data, digest(data), bytes, read.verifiedAt],
      );
    });
  }
  async checkScanLease(source: DiscoverySource) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.held(tx, source);
    });
  }
  async discardScan(source: DiscoverySource) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.held(tx, source);
      await this.clearScan(tx, source.id);
    });
  }
  async deferScan(source: DiscoverySource) {
    await this.db.transaction(async (tx) => {
      await this.lockOwner(tx);
      await this.held(tx, source);
      await tx.query(
        "UPDATE sources SET state='scanning',next_poll_at=$1,lease_token=NULL,lease_until=NULL WHERE owner_id=$2 AND id=$3",
        [new Date(this.clock().getTime() + 5000).toISOString(), this.ownerId, source.id],
      );
    });
  }
}
