// --- TIPOS Y ENUMS ---

// Valores fijos y Enums para evitar errores de "dedo"
export type NotificationScope = 'NOTIFICATION';
export type TargetType = 'USER' | 'TENANT' | 'CONNECTION';
export type UiAction = 'SHOW_TOAST' | 'REDIRECT' | 'HYDRATE' | 'SILENT';
export type UiVariant = 'SUCCESS' | 'ERROR' | 'INFO' | 'WARNING';

// 1. Bloque META (Enrutamiento)
export interface NotificationMeta {
    scope: NotificationScope;
    targetType: TargetType;
    targetId: string;       // Puede ser UUID de usuario, ID de Tenant o ConnectionID
    correlationId?: string; // Opcional, para trackear requests
}

// 2. Bloque UI (Qué hace Svelte)
export interface NotificationUi {
    action: UiAction;
    variant?: UiVariant;    // Default: INFO
    target?: string;        // Store a hidratar
    message: string;        // Texto para el humano
}

// 3. Bloque DATA (Payload dinámico)
// Usamos Record<string, any> porque data puede traer cualquier cosa
export interface NotificationData {
    [key: string]: any;
}

// EL DETALLE COMPLETO (Lo que viene dentro de "Detail")
export interface NotificationDetail {
    meta: NotificationMeta;
    ui: NotificationUi;
    data?: NotificationData;
}

// EL EVENTO DE EVENTBRIDGE (Lo que llega en el Body de SQS)
export interface EventBridgeNotificationEvent {
    id: string;
    version: string;
    account: string;
    time: string;
    region: string;
    resources: string[];

    source: string;        // ANTES: Source
    "detail-type": string; // ANTES: DetailType (AWS usa kebab-case)
    detail: NotificationDetail; // ANTES: Detail
}

// EL MENSAJE FINAL AL CLIENTE (Lo que enviaremos por WebSocket)
// Juntamos todo para que el Frontend tenga contexto completo
export interface ClientPayload {
    meta: Pick<NotificationMeta, 'correlationId' | 'scope'>;
    ui: NotificationUi;
    data?: NotificationData;
}