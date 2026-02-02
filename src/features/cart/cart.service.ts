import { PrismaService } from "../../modules/prisma/prisma.service";
import { ApiError } from "../../utils/api-error";
import { RajaOngkirService } from "../../modules/rajaongkir/rajaongkir.service";
import { ShippingCalculatorService } from "../../services/shipping-calculator.service";

export class CartService {
  private prisma: PrismaService;
  private rajaOngkirService: RajaOngkirService;
  private shippingCalculator: ShippingCalculatorService;

  constructor() {
    this.prisma = new PrismaService();
    this.rajaOngkirService = new RajaOngkirService();
    this.shippingCalculator = new ShippingCalculatorService();
  }

  // ===========================
  // GET USER CART WITH CALCULATIONS
  // ===========================
  getCart = async (userId: number) => {
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        cartItems: {
          include: {
            product: {
              include: {
                game: true,
                set: true,
                images: {
                  where: { isMain: true },
                  take: 1,
                },
              },
            },
            variant: {
              include: {
                rarity: true,
                condition: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Create cart if doesn't exist
    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
        include: {
          cartItems: {
            include: {
              product: {
                include: {
                  game: true,
                  set: true,
                  images: {
                    where: { isMain: true },
                    take: 1,
                  },
                },
              },
              variant: {
                include: {
                  rarity: true,
                  condition: true,
                },
              },
            },
          },
        },
      });
    }

    // ⭐ Format cart items with calculations
    const formattedItems = cart.cartItems.map((item) => {
      const price = Number(item.variant.price);
      const subtotal = price * item.quantity;
      
      // Get weight: variant.weight (if set) or product.weight (fallback)
      const weight = item.variant.weight || item.product.weight;
      const totalWeight = weight * item.quantity;

      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        product: {
          id: item.product.id,
          name: item.product.name,
          slug: item.product.slug,
          productType: item.product.productType,
          thumbnail: item.product.thumbnail,
          image: item.product.images[0]?.url || item.product.thumbnail,
          game: item.product.game,
          set: item.product.set,
        },
        variant: {
          id: item.variant.id,
          price: price,
          stock: item.variant.stock,
          sku: item.variant.sku,
          rarity: item.variant.rarity,
          condition: item.variant.condition,
          weight: weight,
        },
        // ⭐ Calculations per item
        price: price,
        subtotal: subtotal,
        weight: weight,
        totalWeight: totalWeight,
      };
    });

    // ⭐ Calculate cart summary
    const summary = {
      totalItems: formattedItems.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: formattedItems.reduce((sum, item) => sum + item.subtotal, 0),
      totalWeight: formattedItems.reduce((sum, item) => sum + item.totalWeight, 0),
    };

    return {
      id: cart.id,
      userId: cart.userId,
      items: formattedItems,
      summary: summary,
      createdAt: cart.createdAt,
      updatedAt: cart.updatedAt,
    };
  };

  // ===========================
  // ADD ITEM TO CART
  // ===========================
  addItem = async (
    userId: number,
    productId: number,
    variantId: number,
    quantity: number
  ) => {
    // Validate product and variant
    const product = await this.prisma.product.findFirst({
      where: { id: productId, isActive: true },
    });

    if (!product) {
      throw new ApiError("Product not found", 404);
    }

    const variant = await this.prisma.productVariant.findFirst({
      where: {
        id: variantId,
        productId: productId,
        isActive: true,
      },
    });

    if (!variant) {
      throw new ApiError("Variant not found", 404);
    }

    // Check stock
    if (variant.stock < quantity) {
      throw new ApiError(
        `Insufficient stock. Only ${variant.stock} available`,
        400
      );
    }

    // Get or create cart
    let cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      cart = await this.prisma.cart.create({
        data: { userId },
      });
    }

    // Check if item already exists in cart
    const existingItem = await this.prisma.cartItem.findUnique({
      where: {
        cartId_variantId: {
          cartId: cart.id,
          variantId: variantId,
        },
      },
    });

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity;

      if (newQuantity > variant.stock) {
        throw new ApiError(
          `Cannot add more. Maximum ${variant.stock} available`,
          400
        );
      }

      await this.prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: newQuantity },
      });
    } else {
      // Create new cart item
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: productId,
          variantId: variantId,
          quantity: quantity,
        },
      });
    }

    // Return updated cart
    return await this.getCart(userId);
  };

  // ===========================
  // UPDATE CART ITEM QUANTITY
  // ===========================
  updateItemQuantity = async (
    userId: number,
    cartItemId: number,
    quantity: number
  ) => {
    // Get cart item
    const cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: cartItemId,
        cart: { userId },
      },
      include: {
        variant: true,
      },
    });

    if (!cartItem) {
      throw new ApiError("Cart item not found", 404);
    }

    // Check stock
    if (quantity > cartItem.variant.stock) {
      throw new ApiError(
        `Insufficient stock. Only ${cartItem.variant.stock} available`,
        400
      );
    }

    // Update quantity
    await this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { quantity },
    });

    // Return updated cart
    return await this.getCart(userId);
  };

  // ===========================
  // REMOVE ITEM FROM CART
  // ===========================
  removeItem = async (userId: number, cartItemId: number) => {
    const cartItem = await this.prisma.cartItem.findFirst({
      where: {
        id: cartItemId,
        cart: { userId },
      },
    });

    if (!cartItem) {
      throw new ApiError("Cart item not found", 404);
    }

    await this.prisma.cartItem.delete({
      where: { id: cartItemId },
    });

    // Return updated cart
    return await this.getCart(userId);
  };

  // ===========================
  // CLEAR CART
  // ===========================
  clearCart = async (userId: number) => {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
    });

    if (!cart) {
      throw new ApiError("Cart not found", 404);
    }

    await this.prisma.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return { message: "Cart cleared successfully" };
  };

  // ===========================
  // ⭐ NEW: PREVIEW SHIPPING COST
  // ===========================
  previewShipping = async (
    userId: number,
    addressId: number,
    courier: string
  ) => {
    // Get cart with summary
    const cart = await this.getCart(userId);

    if (cart.items.length === 0) {
      throw new ApiError("Cart is empty", 400);
    }

    // Get address
    const address = await this.prisma.address.findFirst({
      where: {
        id: addressId,
        userId: userId,
      },
    });

    if (!address) {
      throw new ApiError("Address not found", 404);
    }

    const shippingOptions = await this.shippingCalculator.calculateShippingOptions({
      address: {
        postalCode: address.postalCode,
        cityName: address.cityName,
        provinceName: address.provinceName,
        districtName: (address as any).districtName,
        subdistrictName: (address as any).subdistrictName,
      },
      weight: cart.summary.totalWeight,
      courier,
    });

    // Get recommendations
    const cheapest = this.rajaOngkirService.getCheapestShipping(shippingOptions);
    const fastest = this.rajaOngkirService.getFastestShipping(shippingOptions);
    const allOptions = this.rajaOngkirService.getAllShippingOptions(shippingOptions);

    // Calculate totals
    const packagingFee = 2500; // Rp 2,500 default packaging
    
    const estimatedTotalCheapest = cart.summary.subtotal + (cheapest?.cost || 0) + packagingFee;
    const estimatedTotalFastest = cart.summary.subtotal + (fastest?.cost || 0) + packagingFee;

    return {
      cart: {
        items: cart.items,
        summary: cart.summary,
      },
      address: {
        id: address.id,
        label: address.label,
        recipientName: address.recipientName,
        phoneNumber: address.phoneNumber,
        cityId: address.cityId,
        cityName: address.cityName,
        districtName: (address as any).districtName,
        subdistrictName: (address as any).subdistrictName,
        provinceName: address.provinceName,
        street: address.street,
        postalCode: address.postalCode,
      },
      shipping: {
        weight: cart.summary.totalWeight,
        options: allOptions,
        recommendations: {
          cheapest: cheapest,
          fastest: fastest,
        },
      },
      pricing: {
        subtotal: cart.summary.subtotal,
        packagingFee: packagingFee,
        shippingCostCheapest: cheapest?.cost || 0,
        shippingCostFastest: fastest?.cost || 0,
        estimatedTotalCheapest: estimatedTotalCheapest,
        estimatedTotalFastest: estimatedTotalFastest,
      },
    };
  };
}
