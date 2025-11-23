import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

/**
 * Lambda: RevisarStock
 * - Recibe como payload el estado actual enviado por la Step Function (Payload.$ = "$").
 * - Busca:
 *    - Las cantidades solicitadas en: event.detail.items || event.detail.requestedItems || event.detail.itemsRequested
 *    - Los items DB en: event.Responses['DB Inventario'] || event.Responses || event.Items
 * - Para cada item solicitado:
 *    - Encuentra el item DB correspondiente (por productId / itemId)
 *    - Determina campo de disponibilidad (preferencia): quantityAvailable, stock, available, quantity
 *    - Determina campo reservado (preferencia): quantityReserved, reserved
 *    - Intenta UpdateCommand condicional: available >= qty
 * - Si todos los items se reservan -> devuelve reserved: true y detalles.
 * - Si alguno falla -> hace rollback de los updates ya aplicados (intenta) y devuelve reserved: false y detalles.
 *
 * ENV:
 *  - TABLE_NAME (opcional, default "DB Inventario")
 */

const TABLE_NAME = process.env.TABLE_NAME ?? "DB Inventario";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

/* Util: detectar si un objeto parece un item DynamoDB tipado ({ S:..., N:... }) */
function looksLikeDDBItem(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  // check first value shape
  const keys = Object.keys(obj);
  if (keys.length === 0) return false;
  // if values are objects with S or N as key
  return keys.some(k => {
    const v = obj[k];
    return v && typeof v === "object" && (v.S !== undefined || v.N !== undefined || v.M !== undefined || v.L !== undefined || v.BOOL !== undefined);
  });
}

/* Util: normalizar list of requested items -> [{ productId, qty }] */
function extractRequestedItems(input: any): { productId: string; qty: number }[] {
  // Common shapes
  const candidates = [
    input?.detail?.items,
    input?.detail?.products,
    input?.detail?.requestedItems,
    input?.items,
    input?.products,
    input?.requestedItems
  ];

  for (const cand of candidates) {
    if (!cand) continue;
    if (Array.isArray(cand)) {
      // support elements: { productId, qty } or { productId, quantity } or { id, qty }
      const normalized = cand
        .map((it: any) => {
          if (!it) return null;
          const productId = it.productId ?? it.itemId ?? it.id ?? it.product_id;
          const qty = it.qty ?? it.quantity ?? it.requested ?? it.q;
          if (!productId) return null;
          return { productId: String(productId), qty: Number(qty ?? 0) };
        })
        .filter((x): x is { productId: string; qty: number } => x !== null);
      if (normalized.length) return normalized;
    }
  }

  // fallback: if detail has productIds and a parallel quantities map
  if (Array.isArray(input?.detail?.productIds)) {
    const pids = input.detail.productIds;
    const qtys = input.detail.quantities || input.detail.quantitiesMap;
    if (Array.isArray(qtys) && qtys.length === pids.length) {
      return pids.map((pid: any, i: number) => ({ productId: String(pid), qty: Number(qtys[i]) }));
    }
  }

  return [];
}

/* Util: extraer items DB desde la respuesta del batchGetItem */
function extractDbItems(input: any): any[] {
  // Possibilities:
  // input.Responses['DB Inventario']
  // input.Responses
  // input.Items
  // input.responses
  if (input?.Responses && input.Responses["DB Inventario"]) return input.Responses["DB Inventario"];
  if (input?.Responses && Array.isArray(input.Responses)) return input.Responses;
  if (input?.Responses && typeof input.Responses === "object") {
    // maybe caller flattened: Responses: { Items: [...] }
    const firstKey = Object.keys(input.Responses)[0];
    if (Array.isArray(input.Responses[firstKey])) return input.Responses[firstKey];
  }
  if (Array.isArray(input?.Items)) return input.Items;
  if (Array.isArray(input?.responses)) return input.responses;
  if (Array.isArray(input?.Products)) return input.Products;
  return [];
}

/* Elegir campo de disponibilidad y reservado dinamicamente */
function chooseFields(sampleItem: any) {
  const availableCandidates = ["quantityAvailable", "stock", "available", "quantity", "qty"];
  const reservedCandidates = ["quantityReserved", "reserved", "qtyReserved", "held"];

  let availableField = availableCandidates.find(f => sampleItem[f] !== undefined);
  let reservedField = reservedCandidates.find(f => sampleItem[f] !== undefined);

  // defaults
  if (!availableField) availableField = "stock";
  if (!reservedField) reservedField = "reserved";

  return { availableField, reservedField };
}

export const handler = async (event: any): Promise<any> => {
  // event is the state input passed by Step Functions (Payload.$ = "$")
  // try-catch wrapper to rethrow unexpected errors (to allow Step Functions retry)
  try {
    // 1) obtener requested items (productId + qty)
    const requested = extractRequestedItems(event);
    if (!requested.length) {
      // if no requested items found, try if event itself is an array of items
      if (Array.isArray(event)) {
        // try map
        const possible = event
          .map((it: any) => ({ productId: it.productId ?? it.itemId, qty: Number(it.qty ?? it.quantity ?? 0) }))
          .filter(it => it.productId);
        if (possible.length) {
          requested.push(...possible);
        }
      }
    }

    if (!requested.length) {
      // Nothing to reserve; treat as failure
      return { reserved: false, products: [], reason: "No requested items found in input" };
    }

    // 2) obtener items DB desde el resultado de batchGetItem
    const rawDbItems = extractDbItems(event);
    if (!rawDbItems || !rawDbItems.length) {
      return { reserved: false, products: [], reason: "No DB items found in input (batchGetItem result missing)" };
    }

    // 3) deserializar si es necesario (unmarshall)
    const dbItems = rawDbItems.map((it: any) => {
      if (looksLikeDDBItem(it)) {
        try {
          return unmarshall(it);
        } catch (e) {
          // fallback: return as-is
          return it;
        }
      }
      // Maybe it's already plain JS
      return it;
    });

    // 4) create map by productId or itemId
    const dbById = new Map<string, any>();
    for (const d of dbItems) {
      const id = String(d.productId ?? d.itemId ?? d.id ?? d.product_id);
      if (!id) continue;
      dbById.set(id, d);
    }

    // 5) choose fields based on a sample item
    const sample = dbItems[0] ?? {};
    const { availableField, reservedField } = chooseFields(sample);

    // Arrays to collect progress
    const results: any[] = [];
    const appliedUpdates: { key: any; productId: string; qty: number; availableField: string; reservedField: string }[] = [];

    // 6) For each requested item, try update
    for (const req of requested) {
      const productId = req.productId;
      const qty = Number(req.qty ?? 0);
      const dbItem = dbById.get(productId);

      if (!dbItem) {
        results.push({
          productId,
          requested: qty,
          availableBefore: null,
          status: "failed",
          reason: "product_not_found_in_db"
        });
        continue;
      }

      const availableBefore = Number(dbItem[availableField] ?? dbItem.quantityAvailable ?? dbItem.stock ?? 0);

      if (Number.isNaN(qty) || qty <= 0) {
        results.push({
          productId,
          requested: qty,
          availableBefore,
          status: "failed",
          reason: "invalid_requested_quantity"
        });
        continue;
      }

      if (availableBefore < qty) {
        // not enough stock, mark failed
        results.push({
          productId,
          requested: qty,
          availableBefore,
          status: "failed",
          reason: "insufficient_stock"
        });
        continue;
      }

      // Build Key for Update: prefer keys that exist on dbItem (productId mandatory)
      const key: Record<string, any> = {};
      if (dbItem.productId !== undefined) key.productId = dbItem.productId;
      if (dbItem.itemId !== undefined) key.itemId = dbItem.itemId;
      // include partition/sort like tenantId/branchId if present (helps target correct item)
      if (dbItem.tenantId !== undefined) key.tenantId = dbItem.tenantId;
      if (dbItem.branchId !== undefined) key.branchId = dbItem.branchId;

      // Prepare UpdateExpression with dynamic field names
      const updateExpr = `SET #avail = #avail - :q, #res = if_not_exists(#res, :zero) + :q`;
      const exprNames: any = { "#avail": availableField, "#res": reservedField };
      const exprValues: any = { ":q": qty, ":zero": 0 };

      const updateParams = {
        TableName: TABLE_NAME,
        Key: key,
        ConditionExpression: `attribute_exists(${Object.keys(key)[0]}) AND #avail >= :q`,
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: "ALL_NEW" as const
      };

      try {
        const updateResult = await ddb.send(new UpdateCommand(updateParams));
        const updatedAttrs = updateResult.Attributes ?? {};
        results.push({
          productId,
          requested: qty,
          availableBefore,
          availableAfter: Number(updatedAttrs[availableField] ?? updatedAttrs[availableField] ?? null),
          status: "reserved",
          attributes: updatedAttrs
        });

        appliedUpdates.push({ key, productId, qty, availableField, reservedField });
      } catch (err: any) {
        // Conditional failed (likely insufficient stock) or other error
        const isConditional =
          err?.name === "ConditionalCheckFailedException" ||
          err?.name === "ConditionalCheckFailed" ||
          (err?.$metadata && err.$metadata.httpStatusCode === 400);

        if (isConditional) {
          results.push({
            productId,
            requested: qty,
            availableBefore,
            status: "failed",
            reason: "conditional_check_failed_or_insufficient_stock"
          });
        } else {
          // rethrow unexpected errors to allow Step Functions retry logic
          console.error("Unexpected error updating item", productId, err);
          throw err;
        }
      }
    } // end for each requested

    // 7) If any failed, rollback appliedUpdates
    const anyFailed = results.some(r => r.status === "failed");
    if (anyFailed && appliedUpdates.length > 0) {
      // attempt rollback: add back quantity and decrement reserved (best-effort)
      for (const a of appliedUpdates) {
        try {
          const rollbackExpr = `SET #avail = #avail + :q, #res = if_not_exists(#res, :zero) - :q`;
          const rollbackParams = {
            TableName: TABLE_NAME,
            Key: a.key,
            UpdateExpression: rollbackExpr,
            ExpressionAttributeNames: { "#avail": a.availableField, "#res": a.reservedField },
            ExpressionAttributeValues: { ":q": a.qty, ":zero": 0 },
            ReturnValues: "ALL_NEW" as const
          };
          await ddb.send(new UpdateCommand(rollbackParams));
          // best-effort: even if rollback fails, continue
        } catch (rbErr) {
          console.error("Rollback failed for", a.productId, rbErr);
          // continue
        }
      }

      // prepare final response: reserved false, include results
      return { reserved: false, products: results };
    }

    // 8) All reserved successfully
    return { reserved: true, products: results };
  } catch (err) {
    // unexpected failure: rethrow to let Step Function retry (you have retries configured)
    console.error("RevisarStock: unexpected error", err);
    throw err;
  }
};
