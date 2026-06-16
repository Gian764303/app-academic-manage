const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const APP_URL = 'https://ekawent.web.app/?source=notif#actividades';

/** Entrega = fin del día de la fecha (UTC). Sin zona horaria local. */
function getDeadlineMs(fecha) {
  return Date.parse(`${fecha}T23:59:59.000Z`);
}

function hoursUntilDeadline(fecha, nowMs = Date.now()) {
  const deadlineMs = getDeadlineMs(fecha);
  if (Number.isNaN(deadlineMs)) return null;
  return (deadlineMs - nowMs) / 3600000;
}

function reminderKind(hoursLeft) {
  if (hoursLeft == null || hoursLeft <= 0) return null;
  if (hoursLeft >= 23 && hoursLeft < 25) return '24h';
  if (hoursLeft >= 3 && hoursLeft < 5) return '4h';
  return null;
}

function buildGroupedMessage(kind, activities) {
  const titles = activities.map((a) => a.titulo).filter(Boolean);
  const preview = titles.slice(0, 6).join(' · ');
  const extra = titles.length > 6 ? ` (+${titles.length - 6})` : '';

  if (kind === '24h') {
    return {
      title: activities.length === 1 ? '🔔 Entrega en 24 h' : `🔔 ${activities.length} entregas en 24 h`,
      body: `${preview}${extra}`,
      tag: 'act-24h',
    };
  }

  return {
    title: activities.length === 1 ? '⚠ Entrega en 4 h' : `⚠ ${activities.length} entregas en 4 h`,
    body: `${preview}${extra}`,
    tag: 'act-4h',
  };
}

async function wasReminderSent(userId, activityId, kind) {
  const snap = await db.doc(`users/${userId}/notifications/${activityId}-${kind}`).get();
  return snap.exists;
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

async function saveInboxNotification(userId, activityId, kind, msg) {
  await db.doc(`users/${userId}/notifications/${activityId}-${kind}`).set({
    title: msg.title,
    body: msg.body,
    tag: `${msg.tag}-${activityId}`,
    activityId,
    reminderKind: kind,
    read: false,
    url: APP_URL,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function sendGroupedReminder(userId, tokenDocs, kind, activities) {
  const msg = buildGroupedMessage(kind, activities);
  const tokens = tokenDocs.map((t) => t.token);
  if (!tokens.length) return;

  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: msg.title, body: msg.body },
    data: { tag: msg.tag, title: msg.title, body: msg.body },
    webpush: { fcmOptions: { link: APP_URL } },
  });

  logger.info(
    `User ${userId}: ${kind} sent ${response.successCount}/${tokens.length} — ${msg.title}`
  );
  await removeInvalidTokens(tokenDocs, response.responses);

  if (response.successCount > 0) {
    await Promise.all(
      activities.map((activity) => saveInboxNotification(userId, activity.id, kind, msg))
    );
  }
}

exports.sendActivityReminders = onSchedule(
  {
    schedule: '0 * * * *',
    timeZone: 'UTC',
  },
  async () => {
    const nowMs = Date.now();
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

      const activities = (dashSnap.data()?.activities || []).filter(
        (a) => a && !a.done && a.fecha && a.id
      );
      if (!activities.length) continue;

      const pending24h = [];
      const pending4h = [];

      for (const activity of activities) {
        const kind = reminderKind(hoursUntilDeadline(activity.fecha, nowMs));
        if (!kind) continue;
        if (await wasReminderSent(userId, activity.id, kind)) continue;
        if (kind === '24h') pending24h.push(activity);
        else pending4h.push(activity);
      }

      if (pending24h.length) {
        await sendGroupedReminder(userId, tokenDocs, '24h', pending24h);
      }
      if (pending4h.length) {
        await sendGroupedReminder(userId, tokenDocs, '4h', pending4h);
      }
    }
  }
);
