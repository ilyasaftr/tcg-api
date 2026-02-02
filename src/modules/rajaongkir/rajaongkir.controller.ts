import { Request, Response, NextFunction } from "express";
import { RajaOngkirService } from "./rajaongkir.service";
import { ApiError } from "../../utils/api-error";

export class RajaOngkirController {
  private rajaOngkirService: RajaOngkirService;

  constructor() {
    this.rajaOngkirService = new RajaOngkirService();
  }

  /**
   * GET /rajaongkir/provinces
   * Get all provinces
   */
  getProvinces = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provinces = await this.rajaOngkirService.getProvinces();

      res.status(200).json({
        success: true,
        message: "Provinces retrieved successfully",
        data: provinces,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /rajaongkir/provinces/:id
   * Get province by ID (name)
   */
  getProvinceById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const provinceName = req.params.id;

      if (!provinceName) {
        throw new ApiError("Province name is required", 400);
      }

      const province = await this.rajaOngkirService.getProvinceById(provinceName);

      res.status(200).json({
        success: true,
        message: "Province retrieved successfully",
        data: province,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /rajaongkir/cities
   * Search cities with optional filters
   * Query params: provinceId, query
   */
  searchCities = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = {
        provinceId: req.query.provinceId
          ? parseInt(req.query.provinceId as string, 10)
          : undefined,
        query: req.query.query as string | undefined,
      };

      const cities = await this.rajaOngkirService.searchCities(filters);

      res.status(200).json({
        success: true,
        message: "Cities retrieved successfully",
        count: cities.length,
        data: cities,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /rajaongkir/districts
   * List/search districts by city ID
   * Query params: cityId (required), query (optional)
   */
  searchDistricts = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cityId = req.query.cityId
        ? parseInt(req.query.cityId as string, 10)
        : NaN;

      if (Number.isNaN(cityId) || cityId <= 0) {
        throw new ApiError("cityId is required", 400);
      }

      const query = (req.query.query as string | undefined) || undefined;
      const districts = await this.rajaOngkirService.searchDistricts({
        cityId,
        query,
      });

      res.status(200).json({
        success: true,
        message: "Districts retrieved successfully",
        count: districts.length,
        data: districts,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /rajaongkir/subdistricts
   * List sub-districts by district ID
   * Query params: districtId (required)
   */
  searchSubdistricts = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const districtId = req.query.districtId
        ? parseInt(req.query.districtId as string, 10)
        : NaN;

      if (Number.isNaN(districtId) || districtId <= 0) {
        throw new ApiError("districtId is required", 400);
      }

      const subdistricts =
        await this.rajaOngkirService.searchSubdistricts(districtId);

      res.status(200).json({
        success: true,
        message: "Sub-districts retrieved successfully",
        count: subdistricts.length,
        data: subdistricts,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /rajaongkir/cities/:id
   * Get city by ID
   */
  getCityById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cityId = parseInt(req.params.id);

      if (isNaN(cityId)) {
        throw new ApiError("Invalid city ID", 400);
      }

      const city = await this.rajaOngkirService.getCityById(cityId);

      res.status(200).json({
        success: true,
        message: "City retrieved successfully",
        data: city,
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /rajaongkir/cost
   * Calculate shipping cost
   */
  calculateCost = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const costResults = await this.rajaOngkirService.calculateCost(req.body);

      // Get recommendations
      const cheapest = this.rajaOngkirService.getCheapestShipping(costResults);
      const fastest = this.rajaOngkirService.getFastestShipping(costResults);
      const allOptions = this.rajaOngkirService.getAllShippingOptions(costResults);

      res.status(200).json({
        success: true,
        message: "Shipping cost calculated successfully",
        data: {
          origin: req.body.originCityId,
          destination: req.body.destinationCityId,
          weight: req.body.weight,
          results: costResults,
          all_options: allOptions,
          recommendations: {
            cheapest,
            fastest,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /rajaongkir/track
   * Track package
   */
  trackPackage = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const trackingData = await this.rajaOngkirService.trackPackage(req.body);

      res.status(200).json({
        success: true,
        message: "Package tracking retrieved successfully",
        data: trackingData,
      });
    } catch (error) {
      next(error);
    }
  };
}
