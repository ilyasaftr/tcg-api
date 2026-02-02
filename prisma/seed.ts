import * as dotenv from "dotenv";
dotenv.config();

import { Prisma, PrismaClient } from "../src/generated/prisma";
import { generateSlug } from "../src/utils/generate-slug";
import { PasswordService } from "../src/modules/password/password.service";

const SEED = 1337;

type Weighted<T> = { value: T; weight: number };

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);

function seededRandomInt(min: number, max: number): number {
  if (max < min) throw new Error("Invalid range");
  return Math.floor(rand() * (max - min + 1)) + min;
}

function seededRandomFloat(min: number, max: number): number {
  if (max < min) throw new Error("Invalid range");
  return rand() * (max - min) + min;
}

function pickWeighted<T>(items: Weighted<T>[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) throw new Error("pickWeighted: total weight must be > 0");
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.value;
  }
  return items[items.length - 1].value;
}

function toMoneyDecimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value.toFixed(2));
}

function decimalToNumber(value: Prisma.Decimal): number {
  return typeof (value as any).toNumber === "function"
    ? (value as any).toNumber()
    : Number(value.toString());
}

function skuSafe(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function resetDatabase(prisma: PrismaClient): Promise<void> {
  console.log("🧹 Resetting database (deleteMany in FK-safe order)...");

  await prisma.bid.deleteMany({});
  await prisma.auctionFailure.deleteMany({});
  await prisma.auction.deleteMany({});

  await prisma.complaintPhoto.deleteMany({});
  await prisma.complaint.deleteMany({});

  await prisma.orderStatusHistory.deleteMany({});
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});

  await prisma.cartItem.deleteMany({});
  await prisma.cart.deleteMany({});

  await prisma.wishlist.deleteMany({});
  await prisma.review.deleteMany({});

  await prisma.blogComment.deleteMany({});
  await prisma.blogPost.deleteMany({});

  await prisma.address.deleteMany({});
  await prisma.userAuctionStats.deleteMany({});

  await prisma.productImage.deleteMany({});
  await prisma.productVariant.deleteMany({});
  await prisma.product.deleteMany({});

  await prisma.rarity.deleteMany({});
  await prisma.set.deleteMany({});
  await prisma.game.deleteMany({});
  await prisma.language.deleteMany({});

  await prisma.condition.deleteMany({});
  await prisma.sealedCategory.deleteMany({});
  await prisma.accessoryCategory.deleteMany({});

  await prisma.user.deleteMany({});

  console.log("✅ Database reset complete.");
}

async function seedAuctions(params: {
  prisma: PrismaClient;
  now: Date;
  sellerUserIds: number[];
  buyerUserIds: number[];
  variants: Array<{
    id: number;
    price: Prisma.Decimal;
    productId: number;
  }>;
}): Promise<void> {
  const { prisma, now, sellerUserIds, buyerUserIds, variants } = params;
  console.log("🏷️ Seeding auctions + bids...");

  const auctionCount = 8;
  if (variants.length < auctionCount) {
    throw new Error(
      `Not enough variants to seed auctions (needed ${auctionCount}, got ${variants.length})`
    );
  }

  const statuses: Prisma.AuctionStatus[] = [
    "ACTIVE",
    "ACTIVE",
    "ACTIVE",
    "ACTIVE",
    "ACTIVE",
    "ENDED",
    "ENDED",
    "PAYMENT_FAILED",
  ];

  const auctions: Array<{
    id: number;
    status: Prisma.AuctionStatus;
    startPrice: Prisma.Decimal;
    buyOutPrice: Prisma.Decimal;
    startTime: Date;
    endTime: Date | null;
    paymentDeadline: Date | null;
    winnerId: number | null;
  }> = [];

  for (let i = 0; i < auctionCount; i++) {
    const variant = variants[i];
    const status = statuses[i];
    const variantPrice = decimalToNumber(variant.price);

    const startPrice = toMoneyDecimal(variantPrice * seededRandomFloat(0.6, 0.85));
    const buyOutPrice = toMoneyDecimal(
      Math.max(decimalToNumber(startPrice) + 1, variantPrice * seededRandomFloat(1.3, 1.8))
    );

    const sellerId = sellerUserIds[i % sellerUserIds.length];

    let startTime: Date;
    let endTime: Date | null = null;
    let paymentDeadline: Date | null = null;
    let winnerId: number | null = null;

    if (status === "ACTIVE") {
      startTime = new Date(now.getTime() - seededRandomInt(1, 6) * 60 * 60 * 1000);
      endTime = new Date(now.getTime() + seededRandomInt(2, 48) * 60 * 60 * 1000);
    } else if (status === "ENDED") {
      startTime = new Date(now.getTime() - seededRandomInt(5, 9) * 24 * 60 * 60 * 1000);
      endTime = new Date(now.getTime() - seededRandomInt(1, 24) * 60 * 60 * 1000);
      winnerId = buyerUserIds[i % buyerUserIds.length];
      paymentDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    } else {
      // PAYMENT_FAILED
      startTime = new Date(now.getTime() - seededRandomInt(2, 4) * 24 * 60 * 60 * 1000);
      endTime = new Date(now.getTime() - seededRandomInt(2, 12) * 60 * 60 * 1000);
      winnerId = buyerUserIds[(i + 1) % buyerUserIds.length];
      paymentDeadline = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    }

    const created = await prisma.auction.create({
      data: {
        productId: variant.productId,
        variantId: variant.id,
        quantity: 1,
        startPrice,
        buyOutPrice,
        currentBid: startPrice,
        minIncrement: toMoneyDecimal(1),
        startTime,
        endTime,
        paymentDeadline,
        status,
        winnerId,
        failureReason: status === "PAYMENT_FAILED" ? "Payment deadline missed" : null,
        createdBy: sellerId,
      },
      select: {
        id: true,
      },
    });

    auctions.push({
      id: created.id,
      status,
      startPrice,
      buyOutPrice,
      startTime,
      endTime,
      paymentDeadline,
      winnerId,
    });
  }

  // Seed bids (~20 total): small dataset, deterministic, valid ordering.
  let totalBids = 0;
  for (const auction of auctions) {
    const bidsForAuction =
      auction.status === "ACTIVE"
        ? seededRandomInt(2, 4)
        : seededRandomInt(2, 3);

    const start = decimalToNumber(auction.startPrice);
    const maxBid = decimalToNumber(auction.buyOutPrice) * 0.95;
    const step = seededRandomFloat(0.5, 3.0);

    const bidTimes: Date[] = [];
    const createdBidAmounts: Prisma.Decimal[] = [];
    let lastAmount = start;

    for (let i = 0; i < bidsForAuction; i++) {
      const bidderId =
        auction.winnerId && i === bidsForAuction - 1
          ? auction.winnerId
          : buyerUserIds[(totalBids + i) % buyerUserIds.length];

      let amountNumber = lastAmount + step;
      if (amountNumber > maxBid) amountNumber = maxBid;
      if (amountNumber <= lastAmount && maxBid > lastAmount) {
        amountNumber = Math.min(maxBid, lastAmount + 0.01);
      }
      lastAmount = amountNumber;
      const bidAmount = toMoneyDecimal(amountNumber);

      const bidTimeBase =
        auction.endTime && auction.endTime.getTime() < now.getTime()
          ? auction.endTime.getTime() - (bidsForAuction - i) * 10 * 60 * 1000
          : now.getTime() - (bidsForAuction - i) * 10 * 60 * 1000;

      const bidTime = new Date(bidTimeBase);

      await prisma.bid.create({
        data: {
          auctionId: auction.id,
          userId: bidderId,
          bidAmount,
          bidTime,
        },
      });

      bidTimes.push(bidTime);
      createdBidAmounts.push(bidAmount);
    }

    totalBids += bidsForAuction;

    const lastBidTime = bidTimes[bidTimes.length - 1] ?? null;
    const currentBid =
      createdBidAmounts[createdBidAmounts.length - 1] ?? auction.startPrice;

    await prisma.auction.update({
      where: { id: auction.id },
      data: {
        currentBid,
        lastBidTime,
      },
    });

    if (auction.status === "PAYMENT_FAILED" && auction.winnerId) {
      await prisma.auctionFailure.create({
        data: {
          auctionId: auction.id,
          winnerId: auction.winnerId,
          winningBid: currentBid,
          paymentDeadline:
            auction.paymentDeadline ?? new Date(now.getTime() - 60 * 60 * 1000),
          reason: "Payment deadline missed",
          failedAt: new Date(now.getTime() - 30 * 60 * 1000),
        },
      });
    }
  }

  console.log(`✅ Auctions seeded: ${auctions.length} | Bids seeded: ~${totalBids}`);
}

async function seedBlog(params: {
  prisma: PrismaClient;
  now: Date;
  adminUserId: number;
  commenterUserIds: number[];
}): Promise<void> {
  const { prisma, now, adminUserId, commenterUserIds } = params;
  console.log("📝 Seeding blog posts + comments...");

  const post1 = await prisma.blogPost.create({
    data: {
      title: "How to Spot Value in Modern TCG Singles",
      slug: generateSlug("How to Spot Value in Modern TCG Singles"),
      excerpt:
        "A practical checklist for identifying undervalued singles using supply, playability, and print context.",
      content:
        "Tracking price trends is useful, but it’s not everything. Look at playability, reprint risk, and real supply in the market. In this post we break down a repeatable way to evaluate singles—whether you collect or flip.",
      coverImage: null,
      authorId: adminUserId,
      category: "Market",
      tags: ["tcg", "market", "singles"],
      published: true,
      publishedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      viewCount: seededRandomInt(120, 900),
    },
  });

  const post2 = await prisma.blogPost.create({
    data: {
      title: "Sleeves, Toploaders, and Binders: A Storage Guide",
      slug: generateSlug("Sleeves, Toploaders, and Binders: A Storage Guide"),
      excerpt:
        "Protect your collection with the right storage setup—without overspending.",
      content:
        "Storage is part protection and part organization. We cover sleeve fits, when to use top loaders, and how to choose binders for trade binders vs long-term collection storage.",
      coverImage: null,
      authorId: adminUserId,
      category: "Collecting",
      tags: ["tcg", "storage", "accessories"],
      published: true,
      publishedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      viewCount: seededRandomInt(80, 600),
    },
  });

  await prisma.blogPost.create({
    data: {
      title: "Weekly Picks: Cards We’re Watching (Draft)",
      slug: generateSlug("Weekly Picks: Cards We’re Watching Draft"),
      excerpt: "Draft notes for upcoming weekly picks.",
      content:
        "Draft: This post is not published yet. It will include 5–10 singles with quick notes about price movement and play trends.",
      coverImage: null,
      authorId: adminUserId,
      category: "Weekly",
      tags: ["tcg", "weekly", "draft"],
      published: false,
      publishedAt: null,
      viewCount: 0,
    },
  });

  // ~10 comments across the 2 published posts: 6 top-level + 4 replies.
  const topLevelComments: Array<{ id: number; postId: number }> = [];
  const publishedPosts = [post1, post2];

  for (let i = 0; i < 6; i++) {
    const post = publishedPosts[i % publishedPosts.length];
    const authorId = commenterUserIds[i % commenterUserIds.length];
    const created = await prisma.blogComment.create({
      data: {
        postId: post.id,
        userId: authorId,
        content:
          i % 2 === 0
            ? "Solid breakdown—especially the part about balancing playability with reprint risk."
            : "This is helpful. Any recommendations for budget-friendly binders that still feel premium?",
        isEdited: i === 3,
      },
      select: { id: true, postId: true },
    });
    topLevelComments.push(created);
  }

  for (let i = 0; i < 4; i++) {
    const parent = topLevelComments[i % topLevelComments.length];
    const authorId = commenterUserIds[(i + 2) % commenterUserIds.length];
    await prisma.blogComment.create({
      data: {
        postId: parent.postId,
        userId: authorId,
        parentId: parent.id,
        content:
          "Agree. Also worth noting that humidity control matters more than people think—especially for foils.",
        isEdited: false,
      },
    });
  }

  const [post1Comments, post2Comments] = await prisma.$transaction([
    prisma.blogComment.count({ where: { postId: post1.id } }),
    prisma.blogComment.count({ where: { postId: post2.id } }),
  ]);

  await prisma.$transaction([
    prisma.blogPost.update({
      where: { id: post1.id },
      data: { commentCount: post1Comments },
    }),
    prisma.blogPost.update({
      where: { id: post2.id },
      data: { commentCount: post2Comments },
    }),
  ]);

  console.log(
    `✅ Blog seeded: posts=3 | comments=${post1Comments + post2Comments}`
  );
}

async function seedCoreCatalog(prisma: PrismaClient): Promise<void> {
  console.log("🌱 Seeding core TCG catalog (medium dataset)...");

  const passwordService = new PasswordService();
  const seedPasswordPlain = "Password123!";
  const seededEmails = [
    "admin@tcg.local",
    "user@tcg.local",
    "buyer1@tcg.local",
    "buyer2@tcg.local",
    "seller1@tcg.local",
    "seller2@tcg.local",
  ] as const;

  const seededUsersData = await Promise.all(
    seededEmails.map(async (email) => {
      const isAdmin = email === "admin@tcg.local";
      const isBuyer1 = email === "buyer1@tcg.local";
      const isBuyer2 = email === "buyer2@tcg.local";
      const isSeller1 = email === "seller1@tcg.local";
      const isSeller2 = email === "seller2@tcg.local";

      const name = isAdmin
        ? "Admin Demo"
        : email === "user@tcg.local"
          ? "User Demo"
          : isBuyer1
            ? "Buyer One"
            : isBuyer2
              ? "Buyer Two"
              : isSeller1
                ? "Seller One"
                : isSeller2
                  ? "Seller Two"
                  : "Demo User";

      const role: Prisma.Role = isAdmin ? "ADMIN" : "USER";
      const password = await passwordService.hashPassword(seedPasswordPlain);
      return {
        name,
        email,
        password,
        role,
        isVerified: true,
        isActive: true,
      };
    })
  );

  await prisma.user.createMany({ data: seededUsersData });

  const seededUsers = await prisma.user.findMany({
    where: { email: { in: [...seededEmails] } },
    select: { id: true, email: true, role: true },
    orderBy: { id: "asc" },
  });

  const adminUser = seededUsers.find((u) => u.email === "admin@tcg.local");
  if (!adminUser) throw new Error("Seed admin user not found after creation");

  const buyerUserIds = seededUsers
    .filter((u) => u.email.startsWith("buyer") || u.email === "user@tcg.local")
    .map((u) => u.id);
  const sellerUserIds = seededUsers
    .filter((u) => u.email.startsWith("seller"))
    .map((u) => u.id);

  await prisma.userAuctionStats.createMany({
    data: buyerUserIds.map((userId) => ({ userId })),
  });

  const languages = {
    EN: await prisma.language.create({ data: { name: "English", code: "EN" } }),
    JP: await prisma.language.create({ data: { name: "Japanese", code: "JP" } }),
    ID: await prisma.language.create({
      data: { name: "Indonesian", code: "ID" },
    }),
  } as const;

  const games = {
    POKEMON: await prisma.game.create({
      data: {
        name: "Pokémon TCG",
        slug: "pokemon-tcg",
        description:
          "Collectible card game featuring Pokémon, Trainers, and Energy cards.",
      },
    }),
    YUGIOH: await prisma.game.create({
      data: {
        name: "Yu-Gi-Oh! TCG",
        slug: "yu-gi-oh-tcg",
        description:
          "Trading card game featuring Monsters, Spells, and Traps from the Yu-Gi-Oh! universe.",
      },
    }),
    MTG: await prisma.game.create({
      data: {
        name: "Magic: The Gathering",
        slug: "magic-the-gathering",
        description:
          "Strategy card game featuring spells and creatures across multiverse planes.",
      },
    }),
  } as const;

  const conditions = {
    NM: await prisma.condition.create({
      data: { name: "Near Mint", shortName: "NM" },
    }),
    LP: await prisma.condition.create({
      data: { name: "Lightly Played", shortName: "LP" },
    }),
    MP: await prisma.condition.create({
      data: { name: "Moderately Played", shortName: "MP" },
    }),
    HP: await prisma.condition.create({
      data: { name: "Heavily Played", shortName: "HP" },
    }),
    DMG: await prisma.condition.create({
      data: { name: "Damaged", shortName: "DMG" },
    }),
  } as const;

  const sealedCategories = {
    BOOSTER_PACK: await prisma.sealedCategory.create({
      data: { name: "Booster Pack", slug: "booster-pack" },
    }),
    BOOSTER_BOX: await prisma.sealedCategory.create({
      data: { name: "Booster Box", slug: "booster-box" },
    }),
    ETB: await prisma.sealedCategory.create({
      data: { name: "Elite Trainer Box", slug: "elite-trainer-box" },
    }),
    STARTER_DECK: await prisma.sealedCategory.create({
      data: { name: "Starter Deck", slug: "starter-deck" },
    }),
    COLLECTION_BOX: await prisma.sealedCategory.create({
      data: { name: "Collection Box", slug: "collection-box" },
    }),
  } as const;

  const accessoryCategories = {
    SLEEVES: await prisma.accessoryCategory.create({
      data: { name: "Sleeves", slug: "sleeves" },
    }),
    DECK_BOX: await prisma.accessoryCategory.create({
      data: { name: "Deck Box", slug: "deck-box" },
    }),
    BINDER: await prisma.accessoryCategory.create({
      data: { name: "Binder", slug: "binder" },
    }),
    PLAYMAT: await prisma.accessoryCategory.create({
      data: { name: "Playmat", slug: "playmat" },
    }),
    TOPLOADER: await prisma.accessoryCategory.create({
      data: { name: "Toploader", slug: "toploader" },
    }),
  } as const;

  type SetSpec = {
    gameKey: keyof typeof games;
    languageKey: "EN" | "JP";
    name: string;
    code: string;
    releaseDate: string;
  };

  const setSpecs: SetSpec[] = [
    // Pokémon (EN/JP)
    {
      gameKey: "POKEMON",
      languageKey: "EN",
      name: "Scarlet & Violet — Paldea Evolved",
      code: "PAL",
      releaseDate: "2023-06-09",
    },
    {
      gameKey: "POKEMON",
      languageKey: "EN",
      name: "Sword & Shield — Evolving Skies",
      code: "EVS",
      releaseDate: "2021-08-27",
    },
    {
      gameKey: "POKEMON",
      languageKey: "JP",
      name: "Scarlet & Violet — Paldea Evolved (JP)",
      code: "PAL-JP",
      releaseDate: "2023-06-09",
    },
    {
      gameKey: "POKEMON",
      languageKey: "JP",
      name: "Sword & Shield — Evolving Skies (JP)",
      code: "EVS-JP",
      releaseDate: "2021-08-27",
    },

    // Yu-Gi-Oh! (EN/JP)
    {
      gameKey: "YUGIOH",
      languageKey: "EN",
      name: "Power of the Elements",
      code: "POTE",
      releaseDate: "2022-08-05",
    },
    {
      gameKey: "YUGIOH",
      languageKey: "EN",
      name: "Duelist Nexus",
      code: "DUNE",
      releaseDate: "2023-07-28",
    },
    {
      gameKey: "YUGIOH",
      languageKey: "JP",
      name: "Power of the Elements (JP)",
      code: "POTE-JP",
      releaseDate: "2022-08-05",
    },
    {
      gameKey: "YUGIOH",
      languageKey: "JP",
      name: "Duelist Nexus (JP)",
      code: "DUNE-JP",
      releaseDate: "2023-07-28",
    },

    // MTG (EN/JP)
    {
      gameKey: "MTG",
      languageKey: "EN",
      name: "Kamigawa: Neon Dynasty",
      code: "NEO",
      releaseDate: "2022-02-18",
    },
    {
      gameKey: "MTG",
      languageKey: "EN",
      name: "Modern Horizons 2",
      code: "MH2",
      releaseDate: "2021-06-18",
    },
    {
      gameKey: "MTG",
      languageKey: "JP",
      name: "Kamigawa: Neon Dynasty (JP)",
      code: "NEO-JP",
      releaseDate: "2022-02-18",
    },
    {
      gameKey: "MTG",
      languageKey: "JP",
      name: "Modern Horizons 2 (JP)",
      code: "MH2-JP",
      releaseDate: "2021-06-18",
    },
  ];

  const createdSets: Array<{
    set: { id: number; code: string; name: string };
    gameKey: keyof typeof games;
    languageKey: "EN" | "JP";
  }> = [];

  for (const spec of setSpecs) {
    const game = games[spec.gameKey];
    const language = languages[spec.languageKey];
    const set = await prisma.set.create({
      data: {
        gameId: game.id,
        languageId: language.id,
        name: spec.name,
        slug: generateSlug(`${spec.name} ${spec.languageKey}`),
        code: spec.code,
        releaseDate: new Date(spec.releaseDate),
        description: `${spec.name} is a popular expansion for ${game.name}.`,
      },
    });

    createdSets.push({
      set: { id: set.id, code: spec.code, name: spec.name },
      gameKey: spec.gameKey,
      languageKey: spec.languageKey,
    });
  }

  const rarityTemplates = {
    POKEMON: [
      { name: "Common", shortName: "C" },
      { name: "Uncommon", shortName: "U" },
      { name: "Rare", shortName: "R" },
      { name: "Holo Rare", shortName: "HR" },
      { name: "Ultra Rare", shortName: "UR" },
      { name: "Secret Rare", shortName: "SR" },
    ],
    YUGIOH: [
      { name: "Common", shortName: "C" },
      { name: "Rare", shortName: "R" },
      { name: "Super Rare", shortName: "SR" },
      { name: "Ultra Rare", shortName: "UR" },
      { name: "Secret Rare", shortName: "SCR" },
      { name: "Starlight Rare", shortName: "STAR" },
    ],
    MTG: [
      { name: "Common", shortName: "C" },
      { name: "Uncommon", shortName: "U" },
      { name: "Rare", shortName: "R" },
      { name: "Mythic Rare", shortName: "MR" },
      { name: "Foil", shortName: "FOIL" },
      { name: "Borderless", shortName: "BORD" },
    ],
  } as const;

  const raritiesBySetId = new Map<
    number,
    Record<string, { id: number; name: string; shortName: string }>
  >();

  for (const entry of createdSets) {
    const template = rarityTemplates[entry.gameKey];
    const rarityMap: Record<string, { id: number; name: string; shortName: string }> =
      {};
    for (const r of template) {
      const created = await prisma.rarity.create({
        data: {
          setId: entry.set.id,
          name: r.name,
          shortName: r.shortName,
        },
      });
      rarityMap[r.name] = {
        id: created.id,
        name: created.name,
        shortName: r.shortName,
      };
    }
    raritiesBySetId.set(entry.set.id, rarityMap);
  }

  const pokemonCardTypes = ["Pokémon", "Trainer", "Energy"] as const;
  const pokemonAttributes = [
    "Fire",
    "Water",
    "Grass",
    "Lightning",
    "Psychic",
    "Darkness",
    "Metal",
    "Fairy",
  ] as const;

  const yugiohCardTypes = ["Monster", "Spell", "Trap"] as const;
  const yugiohAttributes = [
    "DARK",
    "LIGHT",
    "EARTH",
    "WATER",
    "FIRE",
    "WIND",
  ] as const;

  const mtgCardTypes = [
    "Creature",
    "Instant",
    "Sorcery",
    "Enchantment",
    "Artifact",
  ] as const;
  const mtgAttributes = ["W", "U", "B", "R", "G", "Colorless"] as const;

  function rarityDistributionFor(gameKey: keyof typeof games): Weighted<string>[] {
    if (gameKey === "POKEMON") {
      return [
        { value: "Common", weight: 45 },
        { value: "Uncommon", weight: 30 },
        { value: "Rare", weight: 15 },
        { value: "Holo Rare", weight: 6 },
        { value: "Ultra Rare", weight: 3 },
        { value: "Secret Rare", weight: 1 },
      ];
    }
    if (gameKey === "YUGIOH") {
      return [
        { value: "Common", weight: 45 },
        { value: "Rare", weight: 22 },
        { value: "Super Rare", weight: 16 },
        { value: "Ultra Rare", weight: 10 },
        { value: "Secret Rare", weight: 6 },
        { value: "Starlight Rare", weight: 1 },
      ];
    }
    return [
      { value: "Common", weight: 42 },
      { value: "Uncommon", weight: 28 },
      { value: "Rare", weight: 16 },
      { value: "Mythic Rare", weight: 5 },
      { value: "Foil", weight: 6 },
      { value: "Borderless", weight: 3 },
    ];
  }

  function priceRangeForRarity(
    rarityName: string
  ): { min: number; max: number } {
    switch (rarityName) {
      case "Common":
        return { min: 0.25, max: 1.5 };
      case "Uncommon":
        return { min: 0.5, max: 3.0 };
      case "Rare":
      case "Holo Rare":
      case "Super Rare":
        return { min: 2, max: 15 };
      case "Mythic Rare":
      case "Ultra Rare":
      case "Secret Rare":
      case "Starlight Rare":
      case "Borderless":
      case "Foil":
        return { min: 10, max: 250 };
      default:
        return { min: 1, max: 10 };
    }
  }

  function stockRangeForRarity(rarityName: string): { min: number; max: number } {
    if (rarityName === "Common" || rarityName === "Uncommon") {
      return { min: 10, max: 80 };
    }
    return { min: 1, max: 15 };
  }

  // Single cards: 12 per set
  for (const entry of createdSets) {
    const gameKey = entry.gameKey;
    const game = games[gameKey];
    const language = languages[entry.languageKey];
    const rarityMap = raritiesBySetId.get(entry.set.id);
    if (!rarityMap) throw new Error(`Missing rarities for set ${entry.set.id}`);

    const rarityDist = rarityDistributionFor(gameKey);

    for (let i = 1; i <= 12; i++) {
      const rarityName = pickWeighted(rarityDist);
      const rarity = rarityMap[rarityName];
      if (!rarity) throw new Error(`Missing rarity '${rarityName}' for set`);

      const cardNumber = `${100 + i}/${193}`;

      let cardType: string | null = null;
      let attribute: string | null = null;
      let hp: number | null = null;

      if (gameKey === "POKEMON") {
        cardType = pokemonCardTypes[seededRandomInt(0, pokemonCardTypes.length - 1)];
        attribute =
          pokemonAttributes[seededRandomInt(0, pokemonAttributes.length - 1)];
        hp = seededRandomInt(60, 340);
      } else if (gameKey === "YUGIOH") {
        cardType = yugiohCardTypes[seededRandomInt(0, yugiohCardTypes.length - 1)];
        attribute =
          yugiohAttributes[seededRandomInt(0, yugiohAttributes.length - 1)];
      } else {
        cardType = mtgCardTypes[seededRandomInt(0, mtgCardTypes.length - 1)];
        attribute = mtgAttributes[seededRandomInt(0, mtgAttributes.length - 1)];
      }

      const cardNameBase =
        gameKey === "POKEMON"
          ? `Stage ${seededRandomInt(1, 2)} ${attribute} Vanguard`
          : gameKey === "YUGIOH"
            ? `${attribute} Sigil ${seededRandomInt(1, 9)}`
            : `${attribute} Rift ${seededRandomInt(1, 9)}`;

      const productName = `${cardNameBase} (${rarity.shortName})`;
      const slug = generateSlug(`${productName} ${entry.set.code} ${cardNumber}`);

      const product = await prisma.product.create({
        data: {
          productType: "SINGLE_CARD",
          name: productName,
          slug,
          description: `${productName} from ${entry.set.name} (${language.name}).`,
          thumbnail: null,
          isActive: true,
          weight: 5,
          gameId: game.id,
          setId: entry.set.id,
          languageId: language.id,
          cardNumber,
          cardType,
          attribute,
          hp,
        },
      });

      const imageMain = `https://picsum.photos/seed/${slug}/800/800`;
      const imageAlt = `https://picsum.photos/seed/${slug}-alt/800/800`;
      await prisma.productImage.createMany({
        data: [
          { productId: product.id, url: imageMain, isMain: true },
          { productId: product.id, url: imageAlt, isMain: false },
        ],
      });

      const priceRange = priceRangeForRarity(rarityName);
      const stockRange = stockRangeForRarity(rarityName);

      const nmPrice = seededRandomFloat(priceRange.min, priceRange.max);
      const lpPrice = Math.max(priceRange.min, nmPrice * seededRandomFloat(0.85, 0.98));

      const nmStock = seededRandomInt(stockRange.min, stockRange.max);
      const lpStock = seededRandomInt(
        stockRange.min,
        Math.max(stockRange.min, Math.floor(stockRange.max * 0.6))
      );

      const baseSku = skuSafe(
        `SKU-${game.slug}-${entry.set.code}-${cardNumber}-${rarity.shortName}`
      );

      await prisma.productVariant.createMany({
        data: [
          {
            productId: product.id,
            rarityId: rarity.id,
            conditionId: conditions.NM.id,
            price: toMoneyDecimal(nmPrice),
            stock: nmStock,
            sku: `${baseSku}-NM`,
            isActive: true,
          },
          {
            productId: product.id,
            rarityId: rarity.id,
            conditionId: conditions.LP.id,
            price: toMoneyDecimal(lpPrice),
            stock: lpStock,
            sku: `${baseSku}-LP`,
            isActive: true,
          },
        ],
      });
    }
  }

  // Sealed products: 2 per set (pack + box), 1 variant each
  for (const entry of createdSets) {
    const game = games[entry.gameKey];
    const language = languages[entry.languageKey];

    const packName = `${entry.set.name} Booster Pack`;
    const packSlug = generateSlug(`${packName} ${entry.set.code}`);
    const pack = await prisma.product.create({
      data: {
        productType: "SEALED_PRODUCT",
        name: packName,
        slug: packSlug,
        description: `A sealed booster pack from ${entry.set.name} (${language.name}).`,
        weight: 20,
        gameId: game.id,
        setId: entry.set.id,
        languageId: language.id,
        sealedCategoryId: sealedCategories.BOOSTER_PACK.id,
        cardsPerPack: 10,
      },
    });
    await prisma.productImage.createMany({
      data: [
        {
          productId: pack.id,
          url: `https://picsum.photos/seed/${packSlug}/800/800`,
          isMain: true,
        },
        {
          productId: pack.id,
          url: `https://picsum.photos/seed/${packSlug}-alt/800/800`,
          isMain: false,
        },
      ],
    });
    await prisma.productVariant.create({
      data: {
        productId: pack.id,
        rarityId: null,
        conditionId: null,
        price: toMoneyDecimal(seededRandomFloat(3.5, 8.99)),
        stock: seededRandomInt(25, 200),
        sku: skuSafe(`SKU-${game.slug}-${entry.set.code}-BOOSTER-PACK`),
        isActive: true,
      },
    });

    const boxName = `${entry.set.name} Booster Box`;
    const boxSlug = generateSlug(`${boxName} ${entry.set.code}`);
    const box = await prisma.product.create({
      data: {
        productType: "SEALED_PRODUCT",
        name: boxName,
        slug: boxSlug,
        description: `A sealed booster box from ${entry.set.name} (${language.name}).`,
        weight: 500,
        gameId: game.id,
        setId: entry.set.id,
        languageId: language.id,
        sealedCategoryId: sealedCategories.BOOSTER_BOX.id,
        cardsPerPack: 10,
        packsPerBox: 36,
      },
    });
    await prisma.productImage.createMany({
      data: [
        {
          productId: box.id,
          url: `https://picsum.photos/seed/${boxSlug}/800/800`,
          isMain: true,
        },
        {
          productId: box.id,
          url: `https://picsum.photos/seed/${boxSlug}-alt/800/800`,
          isMain: false,
        },
      ],
    });
    await prisma.productVariant.create({
      data: {
        productId: box.id,
        rarityId: null,
        conditionId: null,
        price: toMoneyDecimal(seededRandomFloat(79.99, 149.99)),
        stock: seededRandomInt(3, 40),
        sku: skuSafe(`SKU-${game.slug}-${entry.set.code}-BOOSTER-BOX`),
        isActive: true,
      },
    });
  }

  // Accessories: 10 total, 2 per category
  const accessorySpecs: Array<{
    name: string;
    categoryId: number;
    brand: string;
    size?: string;
    color?: string;
    priceMin: number;
    priceMax: number;
    weight: number;
  }> = [
    {
      name: "Dragon Shield Matte Sleeves 100ct (Jet)",
      categoryId: accessoryCategories.SLEEVES.id,
      brand: "Dragon Shield",
      color: "Jet",
      priceMin: 8.99,
      priceMax: 13.99,
      weight: 50,
    },
    {
      name: "KMC Hyper Mat Sleeves 80ct (Clear)",
      categoryId: accessoryCategories.SLEEVES.id,
      brand: "KMC",
      color: "Clear",
      priceMin: 6.99,
      priceMax: 11.99,
      weight: 50,
    },
    {
      name: "Ultimate Guard Boulder 100+ (Black)",
      categoryId: accessoryCategories.DECK_BOX.id,
      brand: "Ultimate Guard",
      color: "Black",
      priceMin: 9.99,
      priceMax: 17.99,
      weight: 50,
    },
    {
      name: "Gamegenic Sidekick 100+ (Blue)",
      categoryId: accessoryCategories.DECK_BOX.id,
      brand: "Gamegenic",
      color: "Blue",
      priceMin: 11.99,
      priceMax: 22.99,
      weight: 50,
    },
    {
      name: "Ultimate Guard Zipfolio 9-Pocket (Black)",
      categoryId: accessoryCategories.BINDER.id,
      brand: "Ultimate Guard",
      size: "9-Pocket",
      color: "Black",
      priceMin: 19.99,
      priceMax: 39.99,
      weight: 50,
    },
    {
      name: "Vault X Premium Binder 12-Pocket (Gray)",
      categoryId: accessoryCategories.BINDER.id,
      brand: "Vault X",
      size: "12-Pocket",
      color: "Gray",
      priceMin: 24.99,
      priceMax: 44.99,
      weight: 50,
    },
    {
      name: "Stitched Edge Playmat (Nebula)",
      categoryId: accessoryCategories.PLAYMAT.id,
      brand: "Ultra PRO",
      size: "60x35cm",
      color: "Nebula",
      priceMin: 14.99,
      priceMax: 29.99,
      weight: 50,
    },
    {
      name: "Stitched Edge Playmat (Forest)",
      categoryId: accessoryCategories.PLAYMAT.id,
      brand: "Gamegenic",
      size: "60x35cm",
      color: "Forest",
      priceMin: 14.99,
      priceMax: 29.99,
      weight: 50,
    },
    {
      name: "3x4 Toploaders 25ct",
      categoryId: accessoryCategories.TOPLOADER.id,
      brand: "Ultra PRO",
      size: "3x4",
      priceMin: 3.99,
      priceMax: 9.99,
      weight: 50,
    },
    {
      name: "Premium Toploaders 35pt 25ct",
      categoryId: accessoryCategories.TOPLOADER.id,
      brand: "BCW",
      size: "35pt",
      priceMin: 4.99,
      priceMax: 10.99,
      weight: 50,
    },
  ];

  for (const spec of accessorySpecs) {
    const slug = generateSlug(spec.name);
    const product = await prisma.product.create({
      data: {
        productType: "ACCESSORY",
        name: spec.name,
        slug,
        description: `${spec.brand} accessory for card storage and play.`,
        weight: spec.weight,
        accessoryCategoryId: spec.categoryId,
        brand: spec.brand,
        size: spec.size,
        color: spec.color,
      },
    });

    await prisma.productImage.createMany({
      data: [
        {
          productId: product.id,
          url: `https://picsum.photos/seed/${slug}/800/800`,
          isMain: true,
        },
        {
          productId: product.id,
          url: `https://picsum.photos/seed/${slug}-alt/800/800`,
          isMain: false,
        },
      ],
    });

    await prisma.productVariant.create({
      data: {
        productId: product.id,
        rarityId: null,
        conditionId: null,
        price: toMoneyDecimal(seededRandomFloat(spec.priceMin, spec.priceMax)),
        stock: seededRandomInt(10, 250),
        sku: skuSafe(`SKU-ACC-${spec.brand}-${spec.name}`),
        isActive: true,
      },
    });
  }

  const now = new Date();

  const auctionVariants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      conditionId: conditions.NM.id,
      product: { productType: "SINGLE_CARD", isActive: true },
    },
    select: {
      id: true,
      price: true,
      productId: true,
    },
    orderBy: { id: "asc" },
    take: 8,
  });

  await seedAuctions({
    prisma,
    now,
    sellerUserIds,
    buyerUserIds,
    variants: auctionVariants,
  });

  await seedBlog({
    prisma,
    now,
    adminUserId: adminUser.id,
    commenterUserIds: buyerUserIds.concat(sellerUserIds),
  });

  console.log("✅ Core catalog seeded.");
  console.log(
    `ℹ️ Languages: ${Object.keys(languages).length} | Games: ${Object.keys(games).length} | Sets: ${createdSets.length}`
  );
  console.log("=".repeat(50));
  console.log("🔐 SEEDED ACCOUNTS");
  console.log("=".repeat(50));
  console.log(`ADMIN  email: admin@tcg.local  password: ${seedPasswordPlain}`);
  console.log(`USER   email: user@tcg.local   password: ${seedPasswordPlain}`);
  console.log(`BUYER1  email: buyer1@tcg.local  password: ${seedPasswordPlain}`);
  console.log(`BUYER2  email: buyer2@tcg.local  password: ${seedPasswordPlain}`);
  console.log(`SELLER1 email: seller1@tcg.local password: ${seedPasswordPlain}`);
  console.log(`SELLER2 email: seller2@tcg.local password: ${seedPasswordPlain}`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await resetDatabase(prisma);
    await seedCoreCatalog(prisma);

    const [
      userCount,
      gameCount,
      setCount,
      productCount,
      variantCount,
      imageCount,
      auctionCount,
      bidCount,
      blogPostCount,
      blogCommentCount,
    ] = await prisma.$transaction([
      prisma.user.count(),
      prisma.game.count(),
      prisma.set.count(),
      prisma.product.count(),
      prisma.productVariant.count(),
      prisma.productImage.count(),
      prisma.auction.count(),
      prisma.bid.count(),
      prisma.blogPost.count(),
      prisma.blogComment.count(),
    ]);

    console.log("=".repeat(50));
    console.log("📊 SEED SUMMARY");
    console.log("=".repeat(50));
    console.log(`Users: ${userCount}`);
    console.log(`Games: ${gameCount}`);
    console.log(`Sets: ${setCount}`);
    console.log(`Products: ${productCount}`);
    console.log(`Variants: ${variantCount}`);
    console.log(`Images: ${imageCount}`);
    console.log(`Auctions: ${auctionCount}`);
    console.log(`Bids: ${bidCount}`);
    console.log(`Blog posts: ${blogPostCount}`);
    console.log(`Blog comments: ${blogCommentCount}`);
    console.log("✅ Done.");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
