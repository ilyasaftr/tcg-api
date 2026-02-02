import { PrismaClient } from "../../generated/prisma";
import { ApiError } from "../../utils/api-error";
import { CreateAddressDto } from "./dto/create-address.dto";
import { UpdateAddressDto } from "./dto/update-address.dto";

export class AddressService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  /**
   * Get all addresses for user
   */
  getAll = async (userId: number) => {
    return await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
  };

  /**
   * Get address by ID
   */
  getById = async (userId: number, addressId: number) => {
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!address) {
      throw new ApiError("Address not found", 404);
    }

    return address;
  };

  /**
   * Get default address
   */
  getDefault = async (userId: number) => {
    return await this.prisma.address.findFirst({
      where: {
        userId,
        isDefault: true,
      },
    });
  };

  /**
   * Create new address
   */
  create = async (userId: number, data: CreateAddressDto) => {
    // If this is set as default, unset other defaults
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // If this is the first address, make it default automatically
    const addressCount = await this.prisma.address.count({ where: { userId } });
    const isDefault = data.isDefault ?? addressCount === 0;

    return await this.prisma.address.create({
      data: {
        userId,
        label: data.label,
        recipientName: data.recipientName,
        phoneNumber: data.phoneNumber,
        // RajaOngkir Location Fields
        provinceId: data.provinceId,
        provinceName: data.provinceName,
        cityId: data.cityId,
        cityName: data.cityName,
        districtName: data.districtName,
        subdistrictName: data.subdistrictName,
        // Address Detail
        street: data.street,
        postalCode: data.postalCode,
        // Auto-fill deprecated fields from RajaOngkir data
        city: data.cityName,
        province: data.provinceName,
        isDefault,
      },
    });
  };

  /**
   * Update address
   */
  update = async (userId: number, addressId: number, data: UpdateAddressDto) => {
    // Check if address exists and belongs to user
    await this.getById(userId, addressId);

    // If setting as default, unset other defaults
    if (data.isDefault) {
      await this.prisma.address.updateMany({
        where: {
          userId,
          isDefault: true,
          id: { not: addressId },
        },
        data: { isDefault: false },
      });
    }

    // Build update data object
    const updateData: any = {};

    if (data.label !== undefined) updateData.label = data.label;
    if (data.recipientName !== undefined) updateData.recipientName = data.recipientName;
    if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;

    // RajaOngkir Location Fields
    if (data.provinceId !== undefined) updateData.provinceId = data.provinceId;
    if (data.provinceName !== undefined) {
      updateData.provinceName = data.provinceName;
      // Auto-update deprecated field
      updateData.province = data.provinceName;
    }
    if (data.cityId !== undefined) updateData.cityId = data.cityId;
    if (data.cityName !== undefined) {
      updateData.cityName = data.cityName;
      // Auto-update deprecated field
      updateData.city = data.cityName;
    }
    if (data.districtName !== undefined) updateData.districtName = data.districtName;
    if (data.subdistrictName !== undefined) updateData.subdistrictName = data.subdistrictName;

    // Address Detail
    if (data.street !== undefined) updateData.street = data.street;
    if (data.postalCode !== undefined) updateData.postalCode = data.postalCode;

    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    return await this.prisma.address.update({
      where: { id: addressId },
      data: updateData,
    });
  };

  /**
   * Delete address
   */
  delete = async (userId: number, addressId: number) => {
    // Check if address exists and belongs to user
    const address = await this.getById(userId, addressId);

    await this.prisma.address.delete({
      where: { id: addressId },
    });

    // If deleted address was default, set another as default
    if (address.isDefault) {
      const firstAddress = await this.prisma.address.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });

      if (firstAddress) {
        await this.prisma.address.update({
          where: { id: firstAddress.id },
          data: { isDefault: true },
        });
      }
    }

    return { message: "Address deleted successfully" };
  };

  /**
   * Set address as default
   */
  setDefault = async (userId: number, addressId: number) => {
    // Check if address exists and belongs to user
    await this.getById(userId, addressId);

    // Unset all defaults for this user
    await this.prisma.address.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });

    // Set this address as default
    return await this.prisma.address.update({
      where: { id: addressId },
      data: { isDefault: true },
    });
  };

  /**
   * Get address count for user
   */
  count = async (userId: number): Promise<number> => {
    return await this.prisma.address.count({
      where: { userId },
    });
  };
}
