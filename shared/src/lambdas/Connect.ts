import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";

// 1. Configuración de Logger Estructurado
// serviceName: ayuda a filtrar logs si tienes muchos lambdas en CloudWatch
const logger = new Logger({ serviceName: "WebSocketService" });

// 2. Cliente DynamoDB Optimizado
const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

const TABLE_NAME = process.env.CONNECTIONS_TABLE;

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {

    // Agrega datos del contexto (Request ID, Memoria, Cold Start) a todos los logs siguientes
    logger.addContext(context);

    // En websockets, el connectionId es VITAL. Es tu llave maestra.
    const connectionId = event.requestContext.connectionId;
    const clientIp = event.requestContext.identity.sourceIp;

    if (!connectionId) {
        logger.error("Intento de conexión sin connectionId");
        return { statusCode: 500, body: "Error interno" };
    }

    logger.info(`Nueva solicitud de conexión desde ${clientIp}`, { connectionId });

    // 3. Calcular TTL (Time To Live)
    // Definimos que una conexión "basura" (sin auth) dura máximo 2 horas (7200 seg)
    // DynamoDB borrará el registro automáticamente después de este tiempo (gratis)
    const TWO_HOURS_IN_SECONDS = 2 * 60 * 60;
    const timestampNow = Math.floor(Date.now() / 1000);
    const ttl = timestampNow + TWO_HOURS_IN_SECONDS;

    // 4. Crear el Ítem "Caso 1: Anónimo"
    // Esto cumple con tu esquema: PK, GSIs, Atributos
    const newItem = {
        connection_id: connectionId,      // PK
        user_id: "ANONYMOUS",             // GSI PK (Estado inicial)
        tenant_id: "GLOBAL",              // GSI PK (Estado inicial)
        Role: "GUEST",                    // Atributo
        ttl: ttl,                         // Atributo (Epoch time)

        // Metadata extra útil para debug (no indexada)
        ip_address: clientIp,
        connected_at: new Date().toISOString(),
        trace_id: context.awsRequestId    // Trazabilidad nativa de Lambda
    };

    try {
        const command = new PutCommand({
            TableName: TABLE_NAME,
            Item: newItem
        });

        await docClient.send(command);

        logger.info("Conexión persistida en DynamoDB exitosamente", {
            userId: "ANONYMOUS",
            role: "GUEST"
        });

        return { statusCode: 200, body: "Connected" };

    } catch (error) {
        // Al usar logger.error con el objeto error, Powertools formatea el Stack Trace bonito
        logger.error("Error guardando conexión en DynamoDB", { error, connectionId });
        return { statusCode: 500, body: "Failed to connect" };
    }
};