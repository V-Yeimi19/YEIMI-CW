import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { Logger } from "@aws-lambda-powertools/logger";

// 1. Configuración de Logger Estructurado
const logger = new Logger({ serviceName: "WebSocketService" });

// 2. Cliente DynamoDB
const client = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.CONNECTIONS_TABLE;

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {

    // Inyectamos datos de trazabilidad (Request ID, etc.)
    logger.addContext(context);

    const connectionId = event.requestContext.connectionId;

    if (!connectionId) {
        logger.warn("Evento de desconexión sin connectionId recibido");
        return { statusCode: 200, body: "Ignored" };
    }

    logger.info("Cliente desconectándose", { connectionId });

    try {
        // 3. Ejecutar Borrado Directo
        // A diferencia del código anterior, tu nueva tabla tiene connection_id como PK única.
        // Un simple DeleteCommand es suficiente y más eficiente que Query + BatchWrite.
        const command = new DeleteCommand({
            TableName: TABLE_NAME,
            Key: {
                // Asegúrate que coincida con tu definición en serverless.yml (connection_id)
                connection_id: connectionId
            }
        });

        await docClient.send(command);

        logger.info("Registro de conexión eliminado exitosamente", { connectionId });

        return { statusCode: 200, body: "Disconnected" };

    } catch (error) {
        // Si falla DynamoDB, loggeamos el error pero devolvemos 200.
        // ¿Por qué? Porque el cliente ya se desconectó físicamente, 
        // devolver un 500 aquí no sirve de nada al frontend.
        // Además, el TTL de tu tabla se encargará de borrar la basura si esto falla.
        logger.error("Error limpiando conexión en DynamoDB", { error, connectionId });

        return { statusCode: 200, body: "Error during disconnect cleanup" };
    }
};