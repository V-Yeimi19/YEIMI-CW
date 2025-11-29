import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Logger } from "@aws-lambda-powertools/logger";

// 1. Configuración
const logger = new Logger({ serviceName: "WebSocketService" });
const ebClient = new EventBridgeClient({ region: "us-east-1" });

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

export const handler = async (
    event: APIGatewayProxyEvent,
    context: Context
): Promise<APIGatewayProxyResult> => {

    logger.addContext(context);

    if (!EVENT_BUS_NAME) {
        logger.error("Falta la variable de entorno EVENT_BUS_NAME");
        return { statusCode: 500, body: "Configuration Error" };
    }

    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;

    // 2. Logging de advertencia (Igual que antes)
    logger.warn(`[Default Handler] Ruta no encontrada: ${routeKey}`, {
        connectionId,
        routeKey,
        body: event.body
    });

    // Intentamos sacar el 'action' para que el mensaje de error sea más claro
    let attemptedAction = "unknown";
    try {
        if (event.body) {
            const body = JSON.parse(event.body);
            attemptedAction = body.action || "unknown";
        }
    } catch (e) { }

    // 3. PUBLICAR EVENTO DE NOTIFICACIÓN (Delegamos la respuesta)
    if (connectionId) {
        try {
            const detail = {
                meta: {
                    scope: "NOTIFICATION",      // Obligatorio para que tu Regla lo atrape
                    targetType: "CONNECTION",   // Respuesta directa a este socket
                    targetId: connectionId,     // El ID de quien causó el error
                    correlationId: context.awsRequestId
                },
                ui: {
                    // Usamos SHOW_TOAST con variante ERROR para que el usuario vea qué pasó.
                    // Si prefieres que sea invisible, cambia a 'SILENT'.
                    action: "SHOW_TOAST",
                    variant: "ERROR",
                    message: `Error 404: La acción '${attemptedAction}' no existe.`
                },
                data: {
                    requestedRoute: routeKey,
                    info: "Consulta la documentación de la API."
                }
            };

            const command = new PutEventsCommand({
                Entries: [{
                    Source: "app.websocket",
                    DetailType: "WebSocket.RouteNotFound",
                    EventBusName: EVENT_BUS_NAME,
                    // EventBridge requiere que Detail sea un string JSON
                    Detail: JSON.stringify(detail)
                }]
            });

            await ebClient.send(command);
            logger.info("Evento de notificación de error enviado al Bus");

        } catch (error) {
            logger.error("Falló el envío del evento a EventBridge", { error });
        }
    }

    // 4. Retorno silencioso (200 OK)
    // El cliente WebSocket se enterará del error cuando le llegue el mensaje asíncrono.
    return { statusCode: 200, body: "Default handler executed" };
};