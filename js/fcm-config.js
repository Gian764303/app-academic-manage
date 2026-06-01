/**
 * Clave VAPID pública de Firebase Cloud Messaging (Web Push).
 *
 * 1. Firebase Console → Configuración → Cloud Messaging
 * 2. Web Push certificates → Generate key pair
 * 3. Pega la clave pública aquí
 */
export const FCM_VAPID_KEY = 'BO0Ect7IkKgCKJlovAE0bvwnrKMQTUYUTG24k7kV9nhKFkEXFpNj7diikftOT_Fzec-1TEtDi8IjSSbWfblbti0';

/** Zona horaria del recordatorio diario (Cloud Function) — Perú */
export const FCM_REMINDER_TIMEZONE = 'America/Lima';

/** URL al abrir la notificación push */
export const FCM_APP_URL = 'https://ekawent.web.app/?source=notif#actividades';
