import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({});
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

// Esta Lambda espera recibir ya la estructura lista para el Bus
// gracias al InputTransformer de la Regla.
interface RelayEvent {
    Source: string;
    DetailType: string;
    Detail: any; // Puede ser objeto o string
}

export const handler = async (event: RelayEvent) => {
    console.log("🔄 Relaying Event:", JSON.stringify(event));

    try {
        await client.send(new PutEventsCommand({
            Entries: [{
                EventBusName: EVENT_BUS_NAME,
                Source: event.Source || "app.relay", // Default por si acaso
                DetailType: event.DetailType || "Relay.Event",
                // PutEvents exige que Detail sea string
                Detail: typeof event.Detail === 'string' ? event.Detail : JSON.stringify(event.Detail)
            }]
        }));
        return { status: "Relayed" };
    } catch (error) {
        console.error("Error relaying event:", error);
        throw error;
    }
};