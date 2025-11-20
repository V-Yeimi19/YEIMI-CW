/**
 * RevisarStock.ts
 *
 * Lambda handler que recibe un evento `ReservarStock` (EventBridge),
 * verifica en DynamoDB ("DB Inventario") que exista stock suficiente para el item
 * y decrementa `quantityAvailable` (y aumenta `quantityReserved`).
 * Si la actualización es exitosa publica un evento `PedidoReservado` en EventBridge.
 *
 * Supuestos:
 * - El evento de entrada (event.detail) tiene la forma:
 *   {
 *     reservationId: string,
 *     orderId?: string,
 *     itemId: string,
 *     branchId?: string,
 *     quantity: number
 *   }
 *
 * - Tabla DynamoDB: nombre desde env `TABLE_NAME` (por defecto "DB Inventario")
 * - Keys de la tabla: `{ itemId, branchId }` (ajustar si su esquema difiere)
 * - EventBridge: usa `EVENT_BUS_NAME` (por defecto "default")
 *
 * Requisitos de packaging:
 * - Este handler usa AWS SDK v3 modular (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-eventbridge`).
 * - Instalar y empacar las dependencias al desplegar o usar esbuild/zip.
 *
 * Comportamiento de idempotencia básico:
 * - Si la condición (stock suficiente) falla, se publica un evento `PedidoReservado` con status "FAILED" y razón.
 *
 * Nota: adapte Key/atributos a su modelo DynamoDB real (PK name / SK name / nombres de atributos).
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { EventBridgeEvent } from "aws-lambda";

type ReservarStockDetail = {
  reservationId: string;
  orderId?: string;
  itemId: string;
  branchId?: string;
  quantity: number;
};

const TABLE_NAME = process.env.TABLE_NAME ?? "DB Inventario";
const EVENT_BUS = process.env.EVENT_BUS_NAME ?? "default";

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);
const eb = new EventBridgeClient({});

/**
 * Publica un evento PedidoReservado en EventBridge.
 * status: 'RESERVED' | 'FAILED'
 */
async function publishPedidoReservado(detail: object, status: "RESERVED" | "FAILED") {
  const entry = {
    Source: "inventory.service",
    DetailType: "PedidoReservado",
    EventBusName: EVENT_BUS,
    Detail: JSON.stringify({ ...detail, status }),
  };

  await eb.send(new PutEventsCommand({ Entries: [entry] }));
}

/**
 * Handler principal
 */
export const handler = async (
  event: EventBridgeEvent<"ReservarStock", ReservarStockDetail>
): Promise<void> => {
  const { reservationId, orderId, itemId, branchId, quantity } = event.detail;

  if (!itemId || !quantity || quantity <= 0 || !reservationId) {
    const reason = "Payload inválido: faltan itemId / reservationId / quantity > 0";
    await publishPedidoReservado(
      { reservationId, orderId, itemId, branchId, quantity, reason },
      "FAILED"
    );
    throw new Error(reason);
  }

  // Ajustar las claves si su tabla usa otros nombres para PK/SK
  const key: Record<string, any> = { itemId };
  if (branchId !== undefined) {
    key.branchId = branchId;
  }

  const params = {
    TableName: TABLE_NAME,
    Key: key,
    // Asegura que exista el ítem y que haya suficiente stock
    ConditionExpression: "attribute_exists(itemId) AND quantityAvailable >= :qty",
    UpdateExpression:
      "SET quantityAvailable = quantityAvailable - :qty, quantityReserved = if_not_exists(quantityReserved, :zero) + :qty",
    ExpressionAttributeValues: {
      ":qty": quantity,
      ":zero": 0,
    },
    ReturnValues: "ALL_NEW" as const,
  };

  try {
    const updateResult = await ddb.send(new UpdateCommand(params));

    // Opcional: extraer nuevo estado si lo requiere downstream
    const newAttributes = updateResult.Attributes ?? {};

    // Publicar evento de éxito
    await publishPedidoReservado(
      {
        reservationId,
        orderId,
        itemId,
        branchId,
        quantity,
        updatedItem: newAttributes,
      },
      "RESERVED"
    );

    // terminar exitosamente
    return;
  } catch (err: any) {
    // Condición fallida: stock insuficiente o item no existe
    const isConditional =
      err?.name === "ConditionalCheckFailedException" ||
      err?.name === "ConditionalCheckFailed";

    if (isConditional) {
      const reason = "Stock insuficiente o ítem no existe";
      await publishPedidoReservado(
        { reservationId, orderId, itemId, branchId, quantity, reason },
        "FAILED"
      );
      // No lanzamos excepción para evitar retries infinitos si el flujo desea manejar fallo por evento.
      // Si prefiere que Lambda falle y se reintente, re-lanzar el error:
      // throw err;
      return;
    }

    // Otros errores: permiso, throttling, etc. Publicar fallo y re-lanzar para que Lambda pueda retriar según configuración.
    const reason = `Error interno: ${err?.message ?? String(err)}`;
    try {
      await publishPedidoReservado(
        { reservationId, orderId, itemId, branchId, quantity, reason },
        "FAILED"
      );
    } catch (pubErr) {
      // ignore publish failure, pero loguear
      console.error("Fallo al publicar evento de fallo:", pubErr);
    }

    console.error("Error al actualizar stock:", err);
    throw err;
  }
};
