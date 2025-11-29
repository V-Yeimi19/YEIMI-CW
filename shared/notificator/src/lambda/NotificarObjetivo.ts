import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure, SQSRecord, Context } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { NotificationDetail, ClientPayload, EventBridgeNotificationEvent } from '@cw/shared';
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Logger } from "@aws-lambda-powertools/logger";

// ------------------------------------------------------------------
// 1. CONFIGURACIÓN GLOBAL (Fuera del handler para reusar conexión)
// ------------------------------------------------------------------

// Inicializamos Logger
const logger = new Logger({ serviceName: "NotificationService" });

// Inicializamos el cliente. IMPORTANTE: Necesitas el endpoint real de tu API Websocket
// Sugerencia: Pásalo como variable de entorno en serverless.yml
const endpoint = process.env.WEBSOCKET_ENDPOINT;
const tableName = process.env.CONNECTIONS_TABLE;

if (!endpoint || !tableName) {
    throw new Error("Faltan variables de entorno: WEBSOCKET_ENDPOINT o CONNECTIONS_TABLE");
}

// Clientes AWS (Inicializados fuera del handler para reuso)
const apiGwClient = new ApiGatewayManagementApiClient({ region: "us-east-1", endpoint });
const dbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dbClient);

// Nombres de tus Índices
const INDEX_USER = 'user_id-index';
const INDEX_TENANT = 'tenant_id-index';

// ------------------------------------------------------------------
// 2. HANDLER PRINCIPAL (El esqueleto genérico SQS)
// ------------------------------------------------------------------
export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {

    // Inyectamos contexto de la Lambda (Request ID, Cold Start, Memory)
    logger.addContext(context);

    const batchItemFailures: SQSBatchItemFailure[] = [];

    // Usamos map para crear un array de promesas y ejecutarlas en PARALELO
    // Esto es vital para la velocidad que buscas.
    const promises = event.Records.map(async (record) => {
        try {
            // Llamamos a la lógica de negocio
            await processRecord(record);
        } catch (error) {
            logger.error(`Error procesando mensaje ${record.messageId}:`, { error });

            // Si falla, agregamos el ID a la lista de fallos para que SQS lo reintente.
            // NOTA: La lógica de negocio puede decidir NO lanzar error (ej. usuario desconectado)
            // para que no se reintente.
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    });

    // Esperamos a que todas las notificaciones se envíen (o fallen)
    await Promise.all(promises);

    // Retornamos la lista de fallos (si está vacía, SQS asume éxito total)
    return { batchItemFailures };
};

// ------------------------------------------------------------------
// 3. LÓGICA DE NEGOCIO (Lo específico de tus notificaciones)
// ------------------------------------------------------------------
async function processRecord(record: SQSRecord): Promise<void> {
    // 1. Parsear el evento que viene de EventBridge -> SQS
    const ebEvent: EventBridgeNotificationEvent = JSON.parse(record.body);

    // Validación defensiva: A veces 'Detail' es un string si no se configuró bien el mapping
    const detail = (typeof ebEvent.Detail === 'string')
        ? JSON.parse(ebEvent.Detail) as NotificationDetail
        : ebEvent.Detail;

    const { meta, ui, data } = detail;

    // Log estructurado del intento de proceso
    logger.info("Procesando notificación", {
        scope: meta.scope,
        targetType: meta.targetType,
        targetId: meta.targetId
    });

    // 2. Determinar los destinatarios (ConnectionIDs)
    let connectionIds: string[] = [];

    switch (meta.targetType) {
        case 'CONNECTION':
            // El targetId YA ES el connectionId
            connectionIds = [meta.targetId];
            break;

        case 'USER':
            // TODO: Consultar DynamoDB (GSI1) para obtener connections del usuario
            ////console.warn("Lógica de búsqueda por USER pendiente de implementar. Asumiendo que targetId es connectionId para prueba.");
            connectionIds = await getConnectionsByGSI(INDEX_USER, 'user_id', meta.targetId);
            break;

        case 'TENANT':
            // TODO: Consultar DynamoDB (GSI2) para obtener connections del tenant (Broadcast)
            connectionIds = await getConnectionsByGSI(INDEX_TENANT, 'tenant_id', meta.targetId);
            break;
    }

    if (connectionIds.length === 0) {
        logger.warn(`No hay conexiones activas para enviar`, {
            targetType: meta.targetType,
            targetId: meta.targetId
        });
        return;
    }

    // 3. Preparar el Payload para el Cliente (Frontend)
    // Le enviamos 'ui', 'data' y el 'correlationId' para que Svelte sepa qué hacer
    const clientPayload: ClientPayload = {
        meta: {
            scope: meta.scope,
            correlationId: meta.correlationId
        },
        ui: ui,
        data: data
    };

    // 4. Enviar a todos los destinatarios (Fan-out)
    const sendPromises = connectionIds.map(async (connId) => {
        try {
            await apiGwClient.send(new PostToConnectionCommand({
                ConnectionId: connId,
                Data: JSON.stringify(clientPayload), // Serializamos para el socket
            }));
        } catch (error: any) {
            if (error.statusCode === 410) {
                // Usuario desconectado: Aquí podrías borrarlo de tu tabla DynamoDB
                logger.info(`ConnectionId GONE (410)`, { connectionId: connId });
            } else {
                logger.error("Error enviando a WebSocket", { error, connectionId: connId });
                throw error;
            }
        }
    });

    await Promise.all(sendPromises);
}

/**
 * Consulta un GSI para obtener solo los connection_id asociados
 * @param indexName Nombre del índice en DynamoDB
 * @param keyName Nombre de la columna clave (user_id o tenant_id)
 * @param keyValue Valor a buscar (ej. "USER#uuid-juan")
 */
async function getConnectionsByGSI(indexName: string, keyName: string, keyValue: string): Promise<string[]> {
    try {
        const command = new QueryCommand({
            TableName: tableName,
            IndexName: indexName,
            // KeyCondition: user_id = :val
            KeyConditionExpression: `${keyName} = :val`,
            ExpressionAttributeValues: {
                ':val': keyValue
            },
            // Optimización: Solo traemos el connection_id, no toda la fila
            ProjectionExpression: 'connection_id'
        });

        const result = await docClient.send(command);

        if (!result.Items || result.Items.length === 0) {
            return [];
        }

        // Mapeamos el resultado a un array de strings limpio
        return result.Items.map((item: any) => item.connection_id);

    } catch (error) {
        logger.error(`Error consultando DynamoDB GSI ${indexName}:`, { error, keyName, keyValue });
        // Lanzamos error para que la Lambda reintente si fue un fallo de red de DB
        throw error;
    }
}