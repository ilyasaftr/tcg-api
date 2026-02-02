import { Router } from "express";
import { RajaOngkirController } from "./rajaongkir.controller";
import { validateBody } from "../../middlewares/validate.middleware";
import { CalculateCostDto } from "./dto/calculate-cost.dto";
import { TrackPackageDto } from "./dto/track-package.dto";

export class RajaOngkirRouter {
  private router: Router;
  private rajaOngkirController: RajaOngkirController;

  constructor() {
    this.router = Router();
    this.rajaOngkirController = new RajaOngkirController();
    this.initializeRoutes();
  }

  private initializeRoutes = () => {
    // ===========================
    // LOCATION ENDPOINTS (Public)
    // ===========================

    /**
     * GET /rajaongkir/provinces
     * Get all provinces
     */
    this.router.get("/provinces", this.rajaOngkirController.getProvinces);

    /**
     * GET /rajaongkir/provinces/:id
     * Get province by name
     * Example: /rajaongkir/provinces/DKI Jakarta
     */
    this.router.get("/provinces/:id", this.rajaOngkirController.getProvinceById);

    /**
     * GET /rajaongkir/cities
     * Search cities with optional filters
     * Query params:
     *   - provinceId: Filter by province name (e.g., "DKI Jakarta")
     *   - query: Search term (e.g., "jakarta", "bandung")
     * Examples:
     *   - /rajaongkir/cities?query=jakarta
     *   - /rajaongkir/cities?provinceId=DKI Jakarta
     *   - /rajaongkir/cities?provinceId=Jawa Barat&query=bandung
     */
    this.router.get("/cities", this.rajaOngkirController.searchCities);

    /**
     * GET /rajaongkir/districts
     * Query params:
     *   - cityId: required (number)
     *   - query: optional
     * Example:
     *   /rajaongkir/districts?cityId=575
     */
    this.router.get("/districts", this.rajaOngkirController.searchDistricts);

    /**
     * GET /rajaongkir/subdistricts
     * Query params:
     *   - districtId: required (number)
     * Example:
     *   /rajaongkir/subdistricts?districtId=5823
     */
    this.router.get("/subdistricts", this.rajaOngkirController.searchSubdistricts);

    /**
     * GET /rajaongkir/cities/:id
     * Get city by ID
     * Example: /rajaongkir/cities/17486
     */
    this.router.get("/cities/:id", this.rajaOngkirController.getCityById);

    // ===========================
    // SHIPPING COST ENDPOINTS (Public)
    // ===========================

    /**
     * POST /rajaongkir/cost
     * Calculate shipping cost
     * Body:
     * {
     *   "originCityId": 17486,
     *   "destinationCityId": 23,
     *   "weight": 1000,
     *   "courier": "jne"  // or "jne:tiki:pos" for multiple
     * }
     */
    this.router.post(
      "/cost",
      validateBody(CalculateCostDto),
      this.rajaOngkirController.calculateCost
    );

    // ===========================
    // TRACKING ENDPOINTS (Public)
    // ===========================

    /**
     * POST /rajaongkir/track
     * Track package by waybill/resi number
     * Body:
     * {
     *   "waybill": "SOCAG00183235715",
     *   "courier": "jne"
     * }
     */
    this.router.post(
      "/track",
      validateBody(TrackPackageDto),
      this.rajaOngkirController.trackPackage
    );
  };

  getRouter = () => this.router;
}
