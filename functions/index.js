const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const REMINDER_TIMEZONE = 'America/Lima';
const APP_URL = 'https://ekawent.web.app/?source=notif#actividades';

function getTodayInTimezone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildReminderMessages(activities, todayStr) {
  const tomorrowStr = addDays(todayStr, 1);
  const dueToday = activities.filter((a) => a.fecha === todayStr);
  const dueTomorrow = activities.filter((a) => a.fecha === tomorrowStr);
  const messages = [];

  if (dueToday.length) {
    messages.push({
      title: dueToday.length === 1 ? '⚠ Entrega hoy' : `⚠ ${dueToday.length} entregas hoy`,
      body: dueToday.slice(0, 6).map((a) => a.titulo).join(' · '),
      tag: 'act-today',
    });
  }

  if (dueTomorrow.length) {
    messages.push({
      title: dueTomorrow.length === 1 ? '🔔 Entrega mañana' : `🔔 ${dueTomorrow.length} entregas mañana`,
      body: dueTomorrow.slice(0, 6).map((a) => a.titulo).join(' · '),
      tag: 'act-tomorrow',
    });
  }

  return messages;
}

async function removeInvalidTokens(tokenDocs, responses) {
  const batch = db.batch();
  let deletes = 0;
  responses.forEach((resp, idx) => {
    if (
      resp.success === false &&
      (resp.error?.code === 'messaging/invalid-registration-token' ||
        resp.error?.code === 'messaging/registration-token-not-registered')
    ) {
      batch.delete(tokenDocs[idx].ref);
      deletes += 1;
    }
  });
  if (deletes) await batch.commit();
}

async function loadSentLog(userId, todayStr) {
  const ref = db.doc(`users/${userId}/pushMeta/daily`);
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.date !== todayStr) return { ref, sent: new Set() };
  return { ref, sent: new Set(Array.isArray(data.sent) ? data.sent : []) };
}

async function saveSentLog(ref, todayStr, sent) {
  await ref.set({ date: todayStr, sent: [...sent], updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

exports.sendActivityReminders = onSchedule(
  {
    schedule: '0 8,20 * * *',
    timeZone: REMINDER_TIMEZONE,
  },
  async () => {
    const todayStr = getTodayInTimezone(REMINDER_TIMEZONE);
    const tokensSnap = await db.collectionGroup('pushTokens').get();

    if (tokensSnap.empty) {
      logger.info('No push tokens registered.');
      return;
    }

    const tokensByUser = new Map();
    tokensSnap.docs.forEach((docSnap) => {
      const token = docSnap.data()?.token;
      if (!token) return;
      const userId = docSnap.ref.parent.parent?.id;
      if (!userId) return;
      if (!tokensByUser.has(userId)) tokensByUser.set(userId, []);
      tokensByUser.get(userId).push({ ref: docSnap.ref, token });
    });

    for (const [userId, tokenDocs] of tokensByUser.entries()) {
      const dashSnap = await db.doc(`users/${userId}/dashboard/main`).get();
      if (!dashSnap.exists) continue;

      const activities = (dashSnap.data()?.activities || []).filter((a) => a && !a.done && a.fecha);
      const messages = buildReminderMessages(activities, todayStr);
      if (!messages.length) continue;

      const { ref: metaRef, sent } = await loadSentLog(userId, todayStr);
      const pendingMessages = messages.filter((msg) => !sent.has(msg.tag));
      if (!pendingMessages.length) continue;

      const tokens = tokenDocs.map((t) => t.token);

      for (const msg of pendingMessages) {
        const response = await messaging.sendEachForMulticast({
          tokens,
          notification: { title: msg.title, body: msg.body },
          data: { tag: msg.tag, title: msg.title, body: msg.body },
          webpush: { fcmOptions: { link: APP_URL } },
        });

        logger.info(`User ${userId}: sent ${response.successCount}/${tokens.length} — ${msg.title}`);
        await removeInvalidTokens(tokenDocs, response.responses);
        sent.add(msg.tag);
      }

      await saveSentLog(metaRef, todayStr, sent);
    }
  }
);
