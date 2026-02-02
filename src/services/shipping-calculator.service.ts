import { ApiError } from "../utils/api-error";
import { BisteshipService } from "./biteship.service";
import { RajaOngkirService } from "../modules/rajaongkir/rajaongkir.service";

type AddressLike = {
  postalCode: string;
  cityName?: string | null;
  provinceName?: string | null;
  districtName?: string | null;
  subdistrictName?: string | null;
};

type ShippingOption = {
  name: string;
  code: string;
  service: string;
  description: string;
  cost: number;
  etd: string;
};

export class ShippingCalculatorService {
  private rajaOngkir: RajaOngkirService;
  private biteship: BisteshipService;

  constructor() {
    this.rajaOngkir = new RajaOngkirService();
    this.biteship = new BisteshipService();
  }

  private isRateLimited(error: any) {
    const status = error?.statusCode || error?.status || error?.response?.status;
    const message = String(error?.message || "");
    return status === 429 || /daily limit|rate limit|too many/i.test(message);
  }

  private isRajaOngkirUnavailable(error: any) {
    const status = error?.statusCode || error?.status || error?.response?.status;
    const message = String(error?.message || "");

    // Komerce sometimes returns 400 with auth-related message.
    if (/invalid api key|key not found|api key is required/i.test(message)) return true;

    // Missing config thrown from constructor.
    if (/rajaongkir_api_key is required/i.test(message)) return true;

    // Treat explicit auth statuses as unavailable.
    if (status === 401 || status === 403) return true;

    return false;
  }

  private log(message: string, meta?: Record<string, unknown>) {
    // Keep logs concise and avoid secrets.
    if (meta) {
      console.log(`🚚 ${message}`, meta);
      return;
    }
    console.log(`🚚 ${message}`);
  }

  private normalizeEtd(etd: string) {
    const raw = String(etd || "").trim().replace(/\s+/g, " ");
    if (!raw) return raw;

    // Same-day providers sometimes return "0 day" / "0 days" / "0-0 day".
    // Show a clearer estimate instead of "0 days".
    const zeroDay = raw
      .toLowerCase()
      .replace(/\s/g, "")
      .match(/^0(?:-0)?(?:day|days)$/);
    if (zeroDay) return "24 hours";

    if (/(day|days|hari|jam|hour|hours)/i.test(raw)) return raw;

    // Handle formats like "1", "2-3", "1 - 2"
    const numericOnly = raw.replace(/\s/g, "");
    const match = numericOnly.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) return raw;

    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;

    if (!Number.isFinite(start) || !Number.isFinite(end)) return raw;

    const normalizedRange = match[2] ? `${start} - ${end}` : `${start}`;
    const plural = end > 1 ? "days" : "day";
    return `${normalizedRange} ${plural}`;
  }

  private withNormalizedEtd(options: ShippingOption[]) {
    return options.map((o) => ({ ...o, etd: this.normalizeEtd(o.etd) }));
  }

  private async calculateWithBiteship(params: {
    address: AddressLike;
    weight: number;
    courier: string;
  }): Promise<ShippingOption[]> {
    const courierString = Array.from(
      new Set(
        params.courier
          .split(/[:,]/g)
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean)
          // Provider code normalization: RajaOngkir uses `ide`, Biteship uses `idexpress`.
          .map((c) => (c === "ide" ? "idexpress" : c))
      )
    ).join(",");
    const originPostalCode = process.env.ORIGIN_POSTAL_CODE;
    if (!originPostalCode) throw new ApiError("Origin postal code is not configured", 500);

    try {
      const pricing = await this.biteship.getRatesByAreaIds({
        originPostalCode,
        destinationPostalCode: params.address.postalCode,
        weight: params.weight,
        couriers: courierString,
      });

      return this.withNormalizedEtd(pricing.map((p) => ({
        name: p.courier_name,
        code: p.courier_code,
        service: p.courier_service_code,
        description: p.courier_service_name,
        cost: p.price,
        etd: p.shipment_duration_range || p.duration,
      })));
    } catch {
      // Final fallback: legacy postal-code based rates
      const courierResults = await this.biteship.getShippingCost({
        destinationPostalCode: params.address.postalCode,
        weight: params.weight,
        courier: courierString,
      });

      return this.withNormalizedEtd(courierResults.flatMap((c) =>
        c.costs.map((svc) => ({
          name: c.name,
          code: c.code,
          service: svc.service,
          description: svc.description,
          cost: svc.cost[0].value,
          etd: svc.cost[0].etd,
        }))
      ));
    }
  }

  /**
   * RajaOngkir first. If it fails for any reason, fallback to Biteship.
   */
  async calculateShippingOptions(params: {
    address: AddressLike;
    weight: number;
    courier: string;
  }): Promise<ShippingOption[]> {
    try {
      this.log("Calculating shipping (provider=rajaongkir)", {
        courier: params.courier,
        weight: params.weight,
        postalCode: params.address.postalCode,
      });
      const originCityId = await this.rajaOngkir.resolveOriginDestinationId();
      const destinationCityId = await this.rajaOngkir.resolveDomesticDestinationId({
        postalCode: params.address.postalCode,
        cityName: params.address.cityName ?? undefined,
        provinceName: params.address.provinceName ?? undefined,
        districtName: params.address.districtName ?? undefined,
        subdistrictName: params.address.subdistrictName ?? undefined,
      });

      const options = await this.rajaOngkir.calculateCost({
        originCityId,
        destinationCityId,
        weight: params.weight,
        courier: params.courier,
      });
      this.log("Shipping calculated (provider=rajaongkir)", {
        options: options.length,
      });
      return this.withNormalizedEtd(options);
    } catch (error: any) {
      this.log("Shipping failed (provider=rajaongkir)", {
        status: error?.statusCode || error?.status || error?.response?.status,
        message: String(error?.message || ""),
      });

      const reason = this.isRateLimited(error)
        ? "rate-limited"
        : this.isRajaOngkirUnavailable(error)
          ? "unavailable"
          : "error";
      this.log(`RajaOngkir ${reason}; falling back to biteship`, {
        reason: String(error?.message || ""),
      });

      try {
        const options = await this.calculateWithBiteship(params);
        this.log("Shipping calculated (provider=biteship)", {
          options: options.length,
        });
        return this.withNormalizedEtd(options);
      } catch (fallbackError: any) {
        this.log("Shipping failed (provider=biteship)", {
          status:
            fallbackError?.statusCode ||
            fallbackError?.status ||
            fallbackError?.response?.status,
          message: String(fallbackError?.message || ""),
        });
        throw new ApiError("Failed to calculate shipping cost", 502);
      }
    }
  }
}
