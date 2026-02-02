import axios, { AxiosInstance } from "axios";
import { ApiError } from "../../utils/api-error";
import { CalculateCostDto } from "./dto/calculate-cost.dto";
import { SearchCityDto } from "./dto/search-city.dto";
import { TrackPackageDto } from "./dto/track-package.dto";

interface RajaOngkirMeta {
  code: number;
  message: string;
}

interface RajaOngkirApiResponse<T> {
  meta: RajaOngkirMeta;
  data: T;
}

interface RajaOngkirProvince {
  id: number;
  name: string;
}

interface RajaOngkirCity {
  id: number;
  name: string;
  postal_code?: string;
}

interface RajaOngkirDistrict {
  id: number;
  name: string;
}

interface RajaOngkirSubdistrict {
  id: number;
  name: string;
}

interface RajaOngkirShippingOption {
  name: string;
  code: string;
  service: string;
  description: string;
  cost: number;
  etd: string;
}

type RajaOngkirDomesticDestination = {
  id: number;
  label?: string;
  city_name?: string;
  province_name?: string;
  postal_code?: string;
  zip_code?: string;
};

export class RajaOngkirService {
  private shippingClient: AxiosInstance;
  private trackingClient: AxiosInstance;
  private baseUrl: string;
  private domesticDestinationCache = new Map<string, number>();
  private originDestinationIdCache: number | null = null;

  constructor() {
    this.baseUrl =
      process.env.RAJAONGKIR_BASE_URL || "https://rajaongkir.komerce.id/api/v1";

    const apiKey =
      process.env.RAJAONGKIR_API_KEY ||
      process.env.RAJAONGKIR_SHIPPING_KEY ||
      process.env.RAJAONGKIR_TRACKING_KEY;

    if (!apiKey) {
      throw new Error("RAJAONGKIR_API_KEY is required");
    }

    this.shippingClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        key: apiKey,
      },
    });

    this.trackingClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        key: apiKey,
      },
    });
  }

  /**
   * Get all provinces
   */
  getProvinces = async () => {
    try {
      const response = await this.shippingClient.get<
        RajaOngkirApiResponse<RajaOngkirProvince[]>
      >("/destination/province");

      if (response.data.meta.code !== 200) {
        throw new ApiError(
          response.data.meta.message || "Failed to fetch provinces",
          response.data.meta.code
        );
      }

      return response.data.data
        .map((p) => ({
          province_id: p.id,
          province: p.name,
        }))
        .sort((a, b) => a.province.localeCompare(b.province));
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to fetch provinces",
        error.response?.status || 500
      );
    }
  };

  /**
   * Get province by ID or name
   */
  getProvinceById = async (provinceName: string) => {
    try {
      const provinces = await this.getProvinces();
      const province = provinces.find(
        (p) => String(p.province_id).toLowerCase() === provinceName.toLowerCase()
      );

      if (!province) {
        throw new ApiError("Province not found", 404);
      }

      return province;
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to fetch province",
        error.response?.status || 500
      );
    }
  };

  /**
   * Search cities by province ID, then optionally filter by query
   */
  searchCities = async (filters: SearchCityDto) => {
    try {
      if (!filters.provinceId) {
        return [];
      }

      const response = await this.shippingClient.get<
        RajaOngkirApiResponse<RajaOngkirCity[]>
      >(`/destination/city/${filters.provinceId}`);

      if (response.data.meta.code !== 200) {
        throw new ApiError(
          response.data.meta.message || "Failed to fetch cities",
          response.data.meta.code
        );
      }

      const query = (filters.query || "").trim().toLowerCase();

      return response.data.data
        .filter((c) =>
          query ? c.name.toLowerCase().includes(query) : true
        )
        .map((c) => ({
          city_id: c.id,
          province_id: String(filters.provinceId),
          province: String(filters.provinceId),
          type: "City",
          city_name: c.name,
          postal_code: c.postal_code || "",
        }));
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to search cities",
        error.response?.status || 500
      );
    }
  };

  /**
   * List districts by city ID, then optionally filter by query
   */
  searchDistricts = async ({
    cityId,
    query,
  }: {
    cityId: number;
    query?: string;
  }) => {
    try {
      const response = await this.shippingClient.get<
        RajaOngkirApiResponse<RajaOngkirDistrict[]>
      >(`/destination/district/${cityId}`);

      if (response.data.meta.code !== 200) {
        throw new ApiError(
          response.data.meta.message || "Failed to fetch districts",
          response.data.meta.code
        );
      }

      const q = (query || "").trim().toLowerCase();
      return response.data.data
        .filter((d) => (q ? d.name.toLowerCase().includes(q) : true))
        .map((d) => ({ district_id: d.id, district_name: d.name }));
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to search districts",
        error.response?.status || 500
      );
    }
  };

  /**
   * List sub-districts by district ID
   */
  searchSubdistricts = async (districtId: number) => {
    try {
      const response = await this.shippingClient.get<
        RajaOngkirApiResponse<RajaOngkirSubdistrict[]>
      >(`/destination/sub-district/${districtId}`);

      if (response.data.meta.code !== 200) {
        throw new ApiError(
          response.data.meta.message || "Failed to fetch sub-districts",
          response.data.meta.code
        );
      }

      return response.data.data.map((s) => ({
        subdistrict_id: s.id,
        subdistrict_name: s.name,
      }));
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to search sub-districts",
        error.response?.status || 500
      );
    }
  };

  private normalizeForMatch(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private buildLocationSearch(address: {
    postalCode?: string | null;
    subdistrictName?: string | null;
    districtName?: string | null;
    cityName?: string | null;
    provinceName?: string | null;
  }) {
    const parts = [
      address.postalCode,
      address.subdistrictName,
      address.districtName,
      address.cityName,
      address.provinceName,
    ]
      .filter(Boolean)
      .map((s) => String(s));

    return parts.join(" ").trim();
  }

  /**
   * Search domestic destinations (Komerce RajaOngkir)
   */
  searchDomesticDestinations = async (params: {
    search: string;
    limit?: number;
    offset?: number;
  }) => {
    try {
      const response = await this.shippingClient.get<
        RajaOngkirApiResponse<RajaOngkirDomesticDestination[]>
      >("/destination/domestic-destination", {
        params: {
          search: params.search,
          limit: params.limit ?? 999,
          offset: params.offset ?? 0,
        },
      });

      if (response.data.meta.code !== 200) {
        const message =
          response.data.meta.message || "Failed to search destinations";
        const mappedStatus = /daily limit|rate limit|too many/i.test(message)
          ? 429
          : response.data.meta.code || 500;
        throw new ApiError(
          message,
          mappedStatus
        );
      }

      return response.data.data || [];
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message ||
          error.response?.data?.message ||
          "Failed to search destinations",
        error.response?.status || 500
      );
    }
  };

  /**
   * Resolve a domestic destination ID for an address.
   * Prefers exact postal code match when available.
   */
  resolveDomesticDestinationId = async (address: {
    postalCode?: string | null;
    subdistrictName?: string | null;
    districtName?: string | null;
    cityName?: string | null;
    provinceName?: string | null;
  }) => {
    const postalCode = address.postalCode ? String(address.postalCode) : "";
    const cacheKey = this.normalizeForMatch(
      [postalCode, address.subdistrictName, address.districtName, address.cityName, address.provinceName]
        .filter(Boolean)
        .join("|")
    );

    const cached = this.domesticDestinationCache.get(cacheKey);
    if (cached) return cached;

    // Search: postal code is usually the most reliable.
    const search =
      postalCode.trim() ||
      this.buildLocationSearch(address) ||
      address.cityName ||
      "";

    if (!search.trim()) {
      throw new ApiError("Destination not found", 400);
    }

    const results = await this.searchDomesticDestinations({
      search,
      limit: 999,
      offset: 0,
    });

    if (!results.length) {
      throw new ApiError("Destination not found", 400);
    }

    const normalizedPostal = postalCode.trim();
    const normalizedCity = address.cityName
      ? this.normalizeForMatch(address.cityName)
      : "";

    const withPostalMatch = normalizedPostal
      ? results.find((r) => String(r.postal_code ?? r.zip_code ?? "") === normalizedPostal)
      : undefined;

    const withCityMatch =
      !withPostalMatch && normalizedCity
        ? results.find((r) => {
            const label = this.normalizeForMatch(
              String(r.label ?? r.city_name ?? "")
            );
            return label.includes(normalizedCity);
          })
        : undefined;

    const chosen = withPostalMatch || withCityMatch || results[0];
    if (!chosen?.id) {
      throw new ApiError("Destination not found", 400);
    }

    this.domesticDestinationCache.set(cacheKey, chosen.id);
    return chosen.id;
  };

  /**
   * Resolve origin destination ID (cached). Uses RAJAONGKIR_ORIGIN_ID first,
   * otherwise falls back to ORIGIN_CITY_ID. If neither is set, resolves by ORIGIN_POSTAL_CODE.
   */
  resolveOriginDestinationId = async () => {
    if (this.originDestinationIdCache) return this.originDestinationIdCache;

    const fromEnv =
      process.env.RAJAONGKIR_ORIGIN_ID || process.env.ORIGIN_CITY_ID;
    const parsed = fromEnv ? Number.parseInt(fromEnv, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      this.originDestinationIdCache = parsed;
      return parsed;
    }

    const originPostalCode = process.env.ORIGIN_POSTAL_CODE;
    if (!originPostalCode) {
      throw new ApiError(
        "Origin location is not configured (set RAJAONGKIR_ORIGIN_ID or ORIGIN_CITY_ID)",
        500
      );
    }

    const originId = await this.resolveDomesticDestinationId({
      postalCode: originPostalCode,
      cityName: process.env.ORIGIN_CITY_NAME,
      provinceName: process.env.ORIGIN_PROVINCE,
    });

    this.originDestinationIdCache = originId;
    return originId;
  };

  /**
   * Get city by ID
   */
  getCityById = async (cityId: number) => {
    try {
      throw new ApiError(
        "City lookup by ID is not supported without province context",
        400
      );
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        error.response?.data?.meta?.message || "Failed to fetch city",
        error.response?.status || 500
      );
    }
  };

  /**
   * Calculate shipping cost
   */
  calculateCost = async (data: CalculateCostDto) => {
    try {
      const formData = new URLSearchParams();
      formData.append("origin", data.originCityId.toString());
      formData.append("destination", data.destinationCityId.toString());
      formData.append("weight", data.weight.toString());
      formData.append("courier", data.courier.toLowerCase());

      const response = await this.shippingClient.post(
        "/calculate/domestic-cost",
        formData
      );

      console.log("📥 Response:", response.data);

      if (response.data.meta?.code !== 200) {
        const message =
          response.data.meta?.message || "Failed to calculate shipping cost";
        const mappedStatus = /daily limit|rate limit|too many/i.test(message)
          ? 429
          : response.data.meta?.code || 500;
        throw new ApiError(
          message,
          mappedStatus
        );
      }

      const shippingOptions: RajaOngkirShippingOption[] = response.data.data;

      console.log(`✅ Found ${shippingOptions.length} shipping options`);
      return shippingOptions;
    } catch (error: any) {
      console.error("❌ Error calculating cost:", error.message);
      console.error("❌ Error details:", error.response?.data);

      if (error instanceof ApiError) throw error;

      throw new ApiError(
        error.response?.data?.meta?.message ||
          error.response?.data?.message ||
          "Failed to calculate shipping cost",
        error.response?.status || 500
      );
    }
  };

  trackPackage = async (data: TrackPackageDto) => {
    try {
      console.log("📦 Tracking package:", data.waybill);

      // ✅ FIXED: Build query parameters
      const params = new URLSearchParams();
      params.append("awb", data.waybill);
      params.append("courier", data.courier.toLowerCase());
      params.append("last_phone_number", data.lastPhoneNumber); // ✅ REQUIRED: Always send

      console.log("📤 Request URL:", `/track/waybill?${params.toString()}`);

      // ✅ Send as query parameters, not body
      const response = await this.trackingClient.post(
        `/track/waybill?${params.toString()}`,
        {} // Empty body
      );

      console.log("📥 Response status:", response.data.meta?.code || response.data.status?.code);

      // Handle both response formats
      if (response.data.meta?.code === 200 || response.data.status?.code === 200) {
        console.log("✅ Package tracking retrieved successfully");
        return response.data.data;
      }

      throw new ApiError(
        response.data.meta?.message || 
        response.data.status?.description || 
        "Failed to track package",
        response.data.meta?.code || 
        response.data.status?.code || 
        500
      );
    } catch (error: any) {
      console.error("❌ Error tracking package:", error.message);
      console.error("❌ Error response:", error.response?.data);
      
      if (error instanceof ApiError) throw error;
      
      throw new ApiError(
        error.response?.data?.meta?.message ||
        error.response?.data?.status?.description || 
        "Failed to track package",
        error.response?.status || 500
      );
    }
  };

  /**
   * HELPER: Extract city type from city name
   */
  private extractCityType = (cityName: string): string => {
    if (cityName.toLowerCase().includes("kota")) return "Kota";
    if (cityName.toLowerCase().includes("kabupaten")) return "Kabupaten";
    return "Kota";
  };

  /**
   * HELPER: Format city display name
   */
  formatCityName = (city: any): string => {
    return city.label || `${city.type} ${city.city_name}`;
  };

  /**
   * HELPER: Get cheapest shipping option
   */
  getCheapestShipping = (shippingOptions: RajaOngkirShippingOption[]) => {
    if (!shippingOptions || shippingOptions.length === 0) {
      return null;
    }

    const cheapest = shippingOptions.reduce((prev, current) => {
      return current.cost < prev.cost ? current : prev;
    });

    return {
      courier: cheapest.name,
      courierCode: cheapest.code,
      service: cheapest.service,
      description: cheapest.description,
      cost: cheapest.cost,
      etd: cheapest.etd,
    };
  };

  /**
   * HELPER: Get fastest shipping option
   */
  getFastestShipping = (shippingOptions: RajaOngkirShippingOption[]) => {
    if (!shippingOptions || shippingOptions.length === 0) {
      return null;
    }

    const fastest = shippingOptions.reduce((prev, current) => {
      const prevDays = parseInt(prev.etd.split("-")[0]) || 999;
      const currentDays = parseInt(current.etd.split("-")[0]) || 999;
      return currentDays < prevDays ? current : prev;
    });

    return {
      courier: fastest.name,
      courierCode: fastest.code,
      service: fastest.service,
      description: fastest.description,
      cost: fastest.cost,
      etd: fastest.etd,
      etdDays: parseInt(fastest.etd.split("-")[0]) || 999,
    };
  };

  /**
   * HELPER: Get all shipping options with recommendations
   */
  getAllShippingOptions = (shippingOptions: RajaOngkirShippingOption[]) => {
    if (!shippingOptions || shippingOptions.length === 0) {
      return [];
    }

    return shippingOptions
      .map((option) => ({
        courier: option.name,
        courierCode: option.code,
        service: option.service,
        description: option.description,
        cost: option.cost,
        etd: option.etd,
      }))
      .sort((a, b) => a.cost - b.cost);
  };
}
