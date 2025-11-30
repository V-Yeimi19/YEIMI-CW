import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";

const logger = new Logger({ serviceName: "WebSocketAuthIngestor" });
const dbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(dbClient);
const ebClient = new EventBridgeClient({ region: "us-east-1" });

const TABLE_NAME = process.env.CONNECTIONS_TABLE;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {

    logger.addContext(context);
    const connectionId = event.requestContext.connectionId;

    // Usamos el routeKey como el "Nombre del Evento" (DetailType)
    // Ej: Si el front manda action="Pedido.Crear", routeKey será "Pedido.Crear"
    const eventName = event.requestContext.routeKey;

    if (!connectionId || !TABLE_NAME || !EVENT_BUS_NAME) {
        return { statusCode: 500, body: "System Error" };
    }

    try {
        // 1. OBTENER ROL (Enriquecimiento)
        const userRecord = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { connection_id: connectionId }
        }));

        const item = userRecord.Item || {};
        // Valores por defecto seguros
        const userRole = item.Role || 'GUEST';
        const userId = item.user_id || 'ANONYMOUS';
        const tenantId = item.tenant_id || 'GLOBAL';

        // 2. LEER PAYLOAD DEL CLIENTE
        let clientBody: any = {};
        try {
            clientBody = JSON.parse(event.body || "{}");
        } catch (e) {
            logger.warn("Body inválido");
        }

        // 3. CONSTRUIR EVENTO PURO
        // Aquí es donde limpiamos la basura.
        const enrichedDetail = {
            meta: {
                connectionId: connectionId,
                role: userRole,
                userId: userId,
                tenantId: tenantId,
                // PASAMANOS: Si el cliente mandó correlationId, lo pasamos. 
                // Si no, undefined (no lo inventamos).
                correlationId: clientBody.correlationId || clientBody.meta?.correlationId
            },
            // Solo pasamos la data de negocio
            data: clientBody.data || {}
        };

        // 4. PUBLICAR AL BUS
        await ebClient.send(new PutEventsCommand({
            Entries: [{
                Source: "app.websocket.inbound",
                DetailType: eventName, // Ej: "Pedido.Crear"
                EventBusName: EVENT_BUS_NAME,
                Detail: JSON.stringify(enrichedDetail)
            }]
        }));

        logger.info(`Evento ${eventName} ingestado`, {
            role: userRole,
            correlationId: enrichedDetail.meta.correlationId
        });

        return { statusCode: 200, body: "Ack" };

    } catch (error) {
        logger.error("Error crítico en Ingestor", { error });
        return { statusCode: 500, body: "Error" };
    }
};