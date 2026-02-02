import fs from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../utils/api-error";

type KelurahanRecord = {
  id: number;
  name: string;
  postal_code: string;
  district: string;
  city: string;
  province: string;
  lat?: number;
  lng?: number;
  tz?: string;
};

type KodeposData = {
  kelurahan: Record<string, KelurahanRecord>;
  indexes: {
    postal: Record<string, number[]>;
    kelurahan: Record<string, number[]>;
    district: Record<string, number[]>;
    city: Record<string, number[]>;
  };
  metadata?: Record<string, unknown>;
};

type SearchResultItem = {
  id: number;
  subdistrict: string;
  district: string;
  city: string;
  province: string;
  postalCode: string;
  label: string;
  lat?: number;
  lng?: number;
};

type SearchResponse = {
  total: number;
  items: SearchResultItem[];
};

function normalizeQuery(q: string) {
  return q.trim().replace(/\s+/g, " ");
}

function toUpperAscii(s: string) {
  return s.toUpperCase();
}

function isNumericToken(token: string) {
  return /^[0-9]+$/.test(token);
}

class SimpleLru<K, V> {
  private max: number;
  private map = new Map<K, V>();

  constructor(max: number) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value as K | undefined;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

export class LocationsService {
  private data: KodeposData | null = null;
  private indexKeys: {
    postal: string[];
    city: string[];
    district: string[];
    kelurahan: string[];
  } | null = null;

  private keyMatchCache = new SimpleLru<string, string[]>(200);

  private resolveDataPath() {
    const envPath = process.env.KODEPOS_DATA_PATH;
    const candidates = [
      envPath,
      path.resolve(process.cwd(), "data", "kodepos_optimized.json"),
      path.resolve(process.cwd(), "kodepos_optimized.json"),
      path.resolve(process.cwd(), "..", "kodepos_optimized.json"),
    ].filter(Boolean) as string[];

    return candidates[0]!;
  }

  private async loadOnce() {
    if (this.data && this.indexKeys) return;

    const filePath = this.resolveDataPath();

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch (error: any) {
      throw new ApiError(
        `Failed to read kodepos data file: ${filePath}`,
        500
      );
    }

    let parsed: KodeposData;
    try {
      parsed = JSON.parse(raw) as KodeposData;
    } catch (error: any) {
      throw new ApiError("Failed to parse kodepos data JSON", 500);
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !parsed.kelurahan ||
      !parsed.indexes
    ) {
      throw new ApiError("Invalid kodepos data format", 500);
    }

    this.data = parsed;
    this.indexKeys = {
      postal: Object.keys(parsed.indexes.postal || {}),
      city: Object.keys(parsed.indexes.city || {}),
      district: Object.keys(parsed.indexes.district || {}),
      kelurahan: Object.keys(parsed.indexes.kelurahan || {}),
    };
  }

  private getIndexMatchKeys(indexName: keyof NonNullable<LocationsService["indexKeys"]>, qUpper: string) {
    const cacheKey = `${indexName}:${qUpper}`;
    const cached = this.keyMatchCache.get(cacheKey);
    if (cached) return cached;

    const keys = this.indexKeys?.[indexName] || [];

    const exact = keys.includes(qUpper) ? [qUpper] : [];
    if (exact.length) {
      this.keyMatchCache.set(cacheKey, exact);
      return exact;
    }

    const results: string[] = [];

    for (const key of keys) {
      if (key.startsWith(qUpper)) results.push(key);
      if (results.length >= 80) break;
    }

    if (results.length < 80) {
      for (const key of keys) {
        if (!key.startsWith(qUpper) && key.includes(qUpper)) results.push(key);
        if (results.length >= 120) break;
      }
    }

    this.keyMatchCache.set(cacheKey, results);
    return results;
  }

  private addIdsWithScore(
    idScores: Map<number, number>,
    ids: number[],
    score: number
  ) {
    for (const id of ids) {
      idScores.set(id, (idScores.get(id) || 0) + score);
    }
  }

  private buildLabel(record: KelurahanRecord) {
    const postal = record.postal_code ? ` ${record.postal_code}` : "";
    return `${record.name}, ${record.district}, ${record.city}, ${record.province}${postal}`;
  }

  search = async ({
    q,
    limit,
    offset,
  }: {
    q: string;
    limit: number;
    offset: number;
  }): Promise<SearchResponse> => {
    await this.loadOnce();
    const data = this.data!;

    const qNorm = normalizeQuery(q);
    if (!qNorm || qNorm.length < 2) return { total: 0, items: [] };

    const qUpper = toUpperAscii(qNorm);
    const tokens = qUpper.split(" ").filter(Boolean);
    const digitTokens = tokens.filter(isNumericToken);
    const textTokens = tokens.filter((t) => !isNumericToken(t));

    const idScores = new Map<number, number>();

    // Postal code matching (exact + prefix)
    for (const dt of digitTokens) {
      const exactIds = data.indexes.postal[dt];
      if (exactIds?.length) this.addIdsWithScore(idScores, exactIds, 200);

      for (const postalCode of this.indexKeys!.postal) {
        if (postalCode === dt) continue;
        if (postalCode.startsWith(dt)) {
          const ids = data.indexes.postal[postalCode];
          if (ids?.length) this.addIdsWithScore(idScores, ids, 120);
        }
      }
    }

    // Name/district/city matching from indexes
    const textQuery = textTokens.join(" ").trim();
    if (textQuery) {
      const cityKeys = this.getIndexMatchKeys("city", textQuery);
      for (const k of cityKeys) this.addIdsWithScore(idScores, data.indexes.city[k] || [], 60);

      const districtKeys = this.getIndexMatchKeys("district", textQuery);
      for (const k of districtKeys) this.addIdsWithScore(idScores, data.indexes.district[k] || [], 90);

      const subdistrictKeys = this.getIndexMatchKeys("kelurahan", textQuery);
      for (const k of subdistrictKeys) this.addIdsWithScore(idScores, data.indexes.kelurahan[k] || [], 140);
    }

    // If multi-token text query, refine by requiring all tokens to appear in record fields
    const refinedIds: number[] = [];
    const allTextTokens = textTokens;

    const candidateIds = Array.from(idScores.keys());
    for (const id of candidateIds) {
      const record = data.kelurahan[String(id)];
      if (!record) continue;
      const haystack = toUpperAscii(
        `${record.name} ${record.district} ${record.city} ${record.province} ${record.postal_code || ""}`
      );

      const ok = allTextTokens.every((t) => haystack.includes(t));
      if (!ok) continue;

      // Extra boost if exact field matches
      if (record.postal_code && digitTokens.includes(record.postal_code)) {
        idScores.set(id, (idScores.get(id) || 0) + 200);
      }
      if (record.name && toUpperAscii(record.name) === textQuery) {
        idScores.set(id, (idScores.get(id) || 0) + 120);
      }
      if (record.district && toUpperAscii(record.district) === textQuery) {
        idScores.set(id, (idScores.get(id) || 0) + 80);
      }
      if (record.city && toUpperAscii(record.city) === textQuery) {
        idScores.set(id, (idScores.get(id) || 0) + 40);
      }

      refinedIds.push(id);
    }

    refinedIds.sort((a, b) => (idScores.get(b) || 0) - (idScores.get(a) || 0));

    const safeLimit = Math.min(Math.max(limit, 1), 50);
    const safeOffset = Math.max(offset, 0);
    const slice = refinedIds.slice(safeOffset, safeOffset + safeLimit);

    const items: SearchResultItem[] = slice
      .map((id) => {
        const record = data.kelurahan[String(id)];
        if (!record) return null;
        return {
          id: record.id,
          subdistrict: record.name,
          district: record.district,
          city: record.city,
          province: record.province,
          postalCode: record.postal_code,
          label: this.buildLabel(record),
          lat: record.lat,
          lng: record.lng,
        } satisfies SearchResultItem;
      })
      .filter(Boolean) as SearchResultItem[];

    return {
      total: refinedIds.length,
      items,
    };
  };
}

// Backward-compatible export name (existing imports should migrate to LocationsJsonService)
export class LocationsJsonService extends LocationsService {}
