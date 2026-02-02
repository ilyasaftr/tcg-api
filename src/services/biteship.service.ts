import axios from "axios";
import { BITESHIP_API_KEY, BITESHIP_BASE_URL, ORIGIN_POSTAL_CODE } from "../config/env";
import { ApiError } from "../utils/api-error";

// Types
interface BisteshipArea {
  id: string;
  name: string;
  country_name: string;
  country_code: string;
  administrative_division_level_1_name: string; // Province
  administrative_division_level_1_type: string;
  administrative_division_level_2_name: string; // City
  administrative_division_level_2_type: string;
  administrative_division_level_3_name: string;
  administrative_division_level_3_type: string;
  postal_code: number;
  latitude?: number;
  longitude?: number;
}

interface BisteshipCourier {
  available_for_cash_on_delivery: boolean;
  available_for_proof_of_delivery: boolean;
  available_for_instant_waybill_id: boolean;
  available_for_insurance: boolean;
  company: string;
  courier_name: string;
  courier_code: string;
  courier_service_name: string;
  courier_service_code: string;
  description: string;
  duration: string;
  shipment_duration_range: string;
  shipment_duration_unit: string;
  service_type: string;
  shipping_type: string;
  price: number;
  type: string;
}

interface Province {
  province_id: string;
  province: string;
}

interface City {
  city_id: string;
  province_id: string;
  province: string;
  type: string;
  city_name: string;
  postal_code: string;
}

interface CourierResult {
  code: string;
  name: string;
  costs: Array<{
    service: string;
    description: string;
    cost: Array<{
      value: number;
      etd: string;
      note: string;
    }>;
  }>;
}

export class BisteshipService {
  private baseURL: string;
  private apiKey: string;
  private areaIdCache = new Map<string, string>();

  constructor() {
    this.baseURL = BITESHIP_BASE_URL;
    this.apiKey = BITESHIP_API_KEY;

    if (!this.apiKey || this.apiKey === "your_biteship_api_key_here") {
      console.warn("⚠️ Biteship API key not configured properly");
    }
  }

  private ensureConfigured() {
    if (!this.apiKey || this.apiKey === "your_biteship_api_key_here") {
      throw new ApiError("BITESHIP_API_KEY is not configured", 500);
    }
  }

  private getAuthorizationHeaderValue() {
    const value = (this.apiKey || "").trim();
    if (!value) return value;
    if (value.toLowerCase().startsWith("bearer ")) return value;
    if (value.startsWith("eyJ")) return `Bearer ${value}`;
    return value;
  }

  private getBrowserLikeHeaders() {
    // The token you shared behaves like a web token and requires origin/referrer.
    return {
      accept: "application/json",
      origin: "https://biteship.com",
      referer: "https://biteship.com/",
    } as const;
  }

  /**
   * Resolve area ID by postal code (Biteship).
   */
  async getAreaIdByPostalCode(postalCode: string): Promise<string> {
    this.ensureConfigured();
    const normalized = postalCode.toString().trim();
    if (!/^\d{5}$/.test(normalized)) {
      throw new ApiError("Invalid postal code", 400);
    }

    const cached = this.areaIdCache.get(normalized);
    if (cached) return cached;

    try {
      const response = await axios.get(`${this.baseURL}/v1/maps/areas`, {
        headers: {
          Authorization: this.getAuthorizationHeaderValue(),
          ...this.getBrowserLikeHeaders(),
        },
        params: {
          countries: "ID",
          input: normalized,
          type: "single",
        },
      });

      const areas = response.data.areas as BisteshipArea[];
      const match =
        areas.find((a) => String(a.postal_code) === normalized) || areas[0];

      if (!match?.id) {
        throw new ApiError("Destination not found", 400);
      }

      this.areaIdCache.set(normalized, match.id);
      return match.id;
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      const upstreamStatus = error.response?.status;
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Failed to resolve destination";
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        throw new ApiError("Shipping provider authentication failed", 502);
      }
      throw new ApiError(message, upstreamStatus || 500);
    }
  }

  /**
   * Calculate courier rates using Biteship area IDs (preferred).
   */
  async getRatesByAreaIds(params: {
    originPostalCode: string;
    destinationPostalCode: string;
    weight: number;
    couriers: string; // comma-separated
  }): Promise<BisteshipCourier[]> {
    this.ensureConfigured();
    const originAreaId = await this.getAreaIdByPostalCode(params.originPostalCode);
    const destinationAreaId = await this.getAreaIdByPostalCode(
      params.destinationPostalCode
    );

    try {
      const response = await axios.post(
        `${this.baseURL}/v1/rates/couriers?channel=biteship_landing_page`,
        {
          origin_area_id: originAreaId,
          destination_area_id: destinationAreaId,
          couriers: params.couriers,
          items: [
            {
              weight: params.weight,
              height: 1,
              length: 1,
              width: 1,
            },
          ],
        },
        {
          headers: {
            Authorization: this.getAuthorizationHeaderValue(),
            "Content-Type": "application/json",
            ...this.getBrowserLikeHeaders(),
          },
        }
      );

      if (response.data?.success === false) {
        throw new ApiError(
          response.data?.message || "Failed to calculate shipping cost",
          400
        );
      }

      return response.data.pricing as BisteshipCourier[];
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      const upstreamStatus = error.response?.status;
      const message =
        error.response?.data?.message ||
        error.response?.data?.error ||
        "Failed to calculate shipping cost from Biteship";
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        throw new ApiError("Shipping provider authentication failed", 502);
      }
      throw new ApiError(message, upstreamStatus || 500);
    }
  }

  /**
   * Get all provinces in Indonesia
   */
  async getProvinces(): Promise<Province[]> {
    try {
      this.ensureConfigured();
      const response = await axios.get(`${this.baseURL}/v1/maps/areas`, {
        headers: {
          Authorization: this.getAuthorizationHeaderValue(),
          ...this.getBrowserLikeHeaders(),
        },
        params: {
          countries: "ID",
          input: "",
          type: "single",
        },
      });

      const areas = response.data.areas as BisteshipArea[];

      // Extract unique provinces
      const provincesMap = new Map<string, Province>();

      areas.forEach((area) => {
        const provinceName = area.administrative_division_level_1_name;
        if (provinceName && !provincesMap.has(provinceName)) {
          provincesMap.set(provinceName, {
            province_id: provinceName.toLowerCase().replace(/\s+/g, "-"),
            province: provinceName,
          });
        }
      });

      const provinces = Array.from(provincesMap.values());
      console.log(`✅ Fetched ${provinces.length} provinces from Biteship`);
      
      return provinces;
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      console.error("❌ Biteship getProvinces error:", error.response?.data || error.message);
      throw new ApiError(
        error.response?.data?.message || "Failed to fetch provinces from Biteship",
        error.response?.status || 500
      );
    }
  }

  /**
   * Get cities by province ID (province name in Biteship)
   */
  async getCities(provinceId: number | string): Promise<City[]> {
    try {
      // Convert province ID to name if needed
      // Map common province IDs to names (from old RajaOngkir IDs)
      let searchTerm = "";

      if (typeof provinceId === "number") {
        const provinceMap: Record<number, string> = {
          1: "Bali",
          2: "Bangka Belitung",
          3: "Banten",
          4: "Bengkulu",
          5: "DI Yogyakarta",
          6: "DKI Jakarta",
          7: "Gorontalo",
          8: "Jambi",
          9: "Jawa Barat",
          10: "Jawa Tengah",
          11: "Jawa Timur",
          12: "Kalimantan Barat",
          13: "Kalimantan Selatan",
          14: "Kalimantan Tengah",
          15: "Kalimantan Timur",
          16: "Kalimantan Utara",
          17: "Kepulauan Riau",
          18: "Lampung",
          19: "Maluku",
          20: "Maluku Utara",
          21: "Nanggroe Aceh Darussalam (NAD)",
          22: "Nusa Tenggara Barat (NTB)",
          23: "Nusa Tenggara Timur (NTT)",
          24: "Papua",
          25: "Papua Barat",
          26: "Riau",
          27: "Sulawesi Barat",
          28: "Sulawesi Selatan",
          29: "Sulawesi Tengah",
          30: "Sulawesi Tenggara",
          31: "Sulawesi Utara",
          32: "Sumatera Barat",
          33: "Sumatera Selatan",
          34: "Sumatera Utara",
        };
        searchTerm = provinceMap[provinceId] || "";
      } else {
        searchTerm = provinceId;
      }

      if (!searchTerm) {
        throw new Error("Invalid province identifier");
      }

      const response = await axios.get(`${this.baseURL}/v1/maps/areas`, {
        headers: {
          Authorization: this.apiKey,
        },
        params: {
          countries: "ID",
          input: searchTerm,
          type: "single",
        },
      });

      const areas = response.data.areas as BisteshipArea[];

      // Filter and format cities
      const citiesMap = new Map<string, City>();

      areas
        .filter((area) => area.administrative_division_level_1_name === searchTerm)
        .forEach((area) => {
          const cityName = area.administrative_division_level_2_name || area.name;
          const cityType = area.administrative_division_level_2_type || "Kota";
          const provinceName = area.administrative_division_level_1_name;
          const key = `${cityName}-${area.postal_code}`;

          if (!citiesMap.has(key)) {
            citiesMap.set(key, {
              city_id: area.id,
              province_id: provinceName.toLowerCase().replace(/\s+/g, "-"),
              province: provinceName,
              type: cityType,
              city_name: cityName,
              postal_code: area.postal_code.toString(),
            });
          }
        });

      const cities = Array.from(citiesMap.values());
      console.log(`✅ Fetched ${cities.length} cities for ${searchTerm}`);
      
      return cities;
    } catch (error: any) {
      console.error("❌ Biteship getCities error:", error.response?.data || error.message);
      throw new Error("Failed to fetch cities from Biteship");
    }
  }

  /**
   * Get all cities (returns major cities)
   */
  async getAllCities(): Promise<City[]> {
    try {
      const response = await axios.get(`${this.baseURL}/v1/maps/areas`, {
        headers: {
          Authorization: this.apiKey,
        },
        params: {
          countries: "ID",
          input: "",
          type: "single",
        },
      });

      const areas = response.data.areas as BisteshipArea[];

      // Extract unique cities (limit to 200 for performance)
      const citiesMap = new Map<string, City>();

      areas.slice(0, 200).forEach((area) => {
        const cityName = area.administrative_division_level_2_name || area.name;
        const cityType = area.administrative_division_level_2_type || "Kota";
        const provinceName = area.administrative_division_level_1_name;
        const key = `${cityName}-${area.postal_code}`;

        if (!citiesMap.has(key) && provinceName && cityName) {
          citiesMap.set(key, {
            city_id: area.id,
            province_id: provinceName.toLowerCase().replace(/\s+/g, "-"),
            province: provinceName,
            type: cityType,
            city_name: cityName,
            postal_code: area.postal_code.toString(),
          });
        }
      });

      const cities = Array.from(citiesMap.values());
      console.log(`✅ Fetched ${cities.length} cities from Biteship`);
      
      return cities;
    } catch (error: any) {
      console.error("❌ Biteship getAllCities error:", error.response?.data || error.message);
      throw new Error("Failed to fetch cities from Biteship");
    }
  }

  /**
   * Calculate shipping cost using postal code
   */
  async getShippingCost(params: {
    destinationPostalCode: string;
    weight: number;
    courier: string;
  }): Promise<CourierResult[]> {
    try {
      this.ensureConfigured();
      const response = await axios.post(
        `${this.baseURL}/v1/rates/couriers`,
        {
          origin_postal_code: parseInt(ORIGIN_POSTAL_CODE),
          destination_postal_code: parseInt(params.destinationPostalCode),
          couriers: params.courier,
          items: [
            {
              name: "Product",
              description: "Product item",
              value: 10000,
              length: 10,
              width: 10,
              height: 10,
              weight: params.weight,
              quantity: 1,
            },
          ],
        },
        {
          headers: {
            Authorization: this.getAuthorizationHeaderValue(),
            "Content-Type": "application/json",
            ...this.getBrowserLikeHeaders(),
          },
        }
      );

      const couriers = response.data.pricing as BisteshipCourier[];

      // Format to RajaOngkir-like structure
      return this.formatCouriersResponse(couriers);
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      const upstreamStatus = error.response?.status;
      console.error("❌ Biteship getShippingCost error:", error.response?.data || error.message);
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        throw new ApiError("Shipping provider authentication failed", 502);
      }
      throw new ApiError(
        error.response?.data?.message || "Failed to calculate shipping cost from Biteship",
        upstreamStatus || 500
      );
    }
  }

  /**
   * Get shipping costs for multiple couriers
   */
  async getAllCouriersCost(params: {
    destinationPostalCode: string;
    weight: number;
    couriers?: string[];
  }): Promise<CourierResult[]> {
    try {
      this.ensureConfigured();
      const couriers = params.couriers || ["jne", "tiki", "pos"];
      const courierString = couriers.join(",");

      console.log(`📦 Calculating shipping: ${ORIGIN_POSTAL_CODE} → ${params.destinationPostalCode}, ${params.weight}g`);

      const response = await axios.post(
        `${this.baseURL}/v1/rates/couriers`,
        {
          origin_postal_code: parseInt(ORIGIN_POSTAL_CODE),
          destination_postal_code: parseInt(params.destinationPostalCode),
          couriers: courierString,
          items: [
            {
              name: "Product",
              description: "Product items",
              value: 10000,
              length: 10,
              width: 10,
              height: 10,
              weight: params.weight,
              quantity: 1,
            },
          ],
        },
        {
          headers: {
            Authorization: this.getAuthorizationHeaderValue(),
            "Content-Type": "application/json",
            ...this.getBrowserLikeHeaders(),
          },
        }
      );

      const courierResults = response.data.pricing as BisteshipCourier[];
      
      console.log(`✅ Found ${courierResults.length} shipping options`);

      // Format to RajaOngkir-like structure
      return this.formatCouriersResponse(courierResults);
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      const upstreamStatus = error.response?.status;
      console.error("❌ Biteship getAllCouriersCost error:", error.response?.data || error.message);
      if (upstreamStatus === 401 || upstreamStatus === 403) {
        throw new ApiError("Shipping provider authentication failed", 502);
      }
      throw new ApiError(
        error.response?.data?.message || "Failed to calculate shipping costs from Biteship",
        upstreamStatus || 500
      );
    }
  }

  /**
   * Format Biteship response to RajaOngkir-like structure
   */
  private formatCouriersResponse(couriers: BisteshipCourier[]): CourierResult[] {
    const grouped = new Map<string, CourierResult>();

    couriers.forEach((courier) => {
      const code = courier.courier_code.toLowerCase();
      const name = courier.courier_name;

      if (!grouped.has(code)) {
        grouped.set(code, {
          code: code,
          name: name,
          costs: [],
        });
      }

      grouped.get(code)!.costs.push({
        service: courier.courier_service_code,
        description: courier.courier_service_name,
        cost: [
          {
            value: courier.price,
            etd: courier.shipment_duration_range || courier.duration,
            note: courier.description || "",
          },
        ],
      });
    });

    return Array.from(grouped.values());
  }
}
