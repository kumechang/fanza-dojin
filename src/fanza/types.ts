import { z } from "zod";

// FANZA ItemList APIのレスポンス(items[]の1要素)。ドキュメント上、必須が明言されていない
// フィールドが多く、実運用でのフィールド欠損にも強くする必要があるため大半をoptionalにする。
// 個々のアイテムはselectCandidate側でsafeParseし、1件のスキーマ不一致で全体を落とさない。
export const fanzaItemSchema = z.object({
  content_id: z.string(),
  title: z.string(),
  affiliateURL: z.string(),
  date: z.string().optional(),
  imageURL: z
    .object({
      large: z.string().optional(),
    })
    .optional(),
  sampleImageURL: z
    .object({
      sample_l: z
        .object({
          image: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  prices: z
    .object({
      price: z.string().optional(),
      list_price: z.string().optional(),
    })
    .optional(),
  campaign: z
    .array(
      z.object({
        date_begin: z.string().optional(),
        date_end: z.string().optional(),
        title: z.string().optional(),
      })
    )
    .optional(),
  review: z
    .object({
      count: z.number().optional(),
      average: z.union([z.string(), z.number()]).optional(),
    })
    .optional(),
  iteminfo: z
    .object({
      genre: z
        .array(
          z.object({
            id: z.number().optional(),
            name: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export type FanzaItem = z.infer<typeof fanzaItemSchema>;

export const fanzaItemListResponseSchema = z.object({
  result: z.object({
    status: z.number().optional(),
    result_count: z.number().optional(),
    total_count: z.number().optional(),
    first_position: z.number().optional(),
    items: z.array(z.unknown()).optional(),
  }),
});
