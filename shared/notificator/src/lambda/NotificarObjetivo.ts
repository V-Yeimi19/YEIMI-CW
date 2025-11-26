import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure, SQSRecord } from 'aws-lambda';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";

// ------------------------------------------------------------------
// 1. CONFIGURACIÓN GLOBAL (Fuera del handler para reusar conexión)
// ------------------------------------------------------------------

// Inicializamos el cliente. IMPORTANTE: Necesitas el endpoint real de tu API Websocket
// Sugerencia: Pásalo como variable de entorno en serverless.yml
const endpoint = process.env.WEBSOCKET_ENDPOINT;

if (!endpoint) {
    throw new Error("Falta la variable de entorno WEBSOCKET_ENDPOINT");
}

const apiClient = new ApiGatewayManagementApiClient({
    region: "us-east-1",
    endpoint: endpoint
});

// Definimos la forma de tus datos (para que TypeScript te ayude)
interface NotificationPayload {
    connectionId: string;
    message: string | object;
}

// ------------------------------------------------------------------
// 2. HANDLER PRINCIPAL (El esqueleto genérico SQS)
// ------------------------------------------------------------------
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {

    const batchItemFailures: SQSBatchItemFailure[] = [];

    // Usamos map para crear un array de promesas y ejecutarlas en PARALELO
    // Esto es vital para la velocidad que buscas.
    const promises = event.Records.map(async (record) => {
        try {
            // Llamamos a la lógica de negocio
            await processRecord(record);
        } catch (error) {
            console.error(`Error procesando mensaje ${record.messageId}:`, error);

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
    // 1. Parsear el cuerpo (siempre viene como string)
    const body: NotificationPayload = JSON.parse(record.body);
    const { connectionId, message } = body;

    if (!connectionId) {
        console.warn("Mensaje sin connectionId, se descarta.", record.messageId);
        return; // Retornamos sin error para borrarlo de la cola
    }

    try {
        // 2. Enviar a Websocket
        const command = new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: typeof message === 'string' ? message : JSON.stringify(message),
        });

        await apiClient.send(command);

    } catch (error: any) {
        // 3. Manejo inteligente de errores de Websocket

        // Error 410 (Gone): El usuario ya cerró la ventana o se desconectó.
        // NO lanzamos el error hacia arriba. Queremos que SQS borre este mensaje.
        if (error.statusCode === 410) {
            console.log(`ConnectionId ${connectionId} es antiguo (Gone). Limpiando.`);
            return;
        }

        // Cualquier otro error (500, Throttling, Red, etc.):
        // Lanzamos el error para que el `catch` del handler lo capture 
        // y lo ponga en `batchItemFailures` para reintentar luego.
        throw error;
    }
}