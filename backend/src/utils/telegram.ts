import axios from 'axios';

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: chatId, text, parse_mode: 'HTML' },
      { timeout: 5_000 },
    );
  } catch (err: unknown) {
    console.error('[Telegram] Erreur envoi:', err instanceof Error ? err.message : err);
  }
}

export async function getTelegramChatId(db: { companySettings: { findFirst: (args?: object) => Promise<{ notificationSettings: unknown } | null> } }): Promise<string | null> {
  const s = await db.companySettings.findFirst({ select: { notificationSettings: true } } as never);
  if (!s?.notificationSettings) return null;
  const ns = s.notificationSettings as Record<string, unknown>;
  return typeof ns.telegram_chat_id === 'string' ? ns.telegram_chat_id : null;
}
