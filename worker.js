/**
 * Telegram Line-by-Line "Typing" Bot — Cloudflare Worker (single file)
 *
 * رفتار:
 * - هر پیام متنی که در چت خصوصی (پیوی) به ربات فرستاده بشه، به این شکل
 *   به یک گروه مشخص (GROUP_CHAT_ID) منتقل می‌شه:
 *   1) متن بر اساس خط (Enter) تکه‌تکه می‌شه.
 *   2) قبل از هر خط، وضعیت "در حال تایپ..." در گروه نمایش داده می‌شه.
 *   3) بعد از یک مکث کوتاه (متناسب با طول خط)، همون خط به‌صورت یک پیام
 *      جدا در گروه فرستاده می‌شه — یعنی انگار کسی داره زنده تایپ می‌کنه،
 *      نه اینکه کل پیام یکجا کپی/فوروارد بشه.
 *   4) یک تیک تأیید به خود فرستنده در پیوی برگردونده می‌شه.
 * - اگر ADMIN_ID تنظیم شده باشه، فقط پیام‌های همون کاربر پردازش می‌شن
 *   (برای جلوگیری از اینکه هرکسی بتونه از طریق ربات شما به گروه پیام بفرسته).
 *
 * ------------------------------------------------------------------
 * مراحل راه‌اندازی:
 *
 * 1) یک ربات جدید در تلگرام از طریق @BotFather بسازید و توکن (BOT_TOKEN) را بگیرید.
 *
 * 2) آیدی عددی گروه مقصد رو پیدا کنید:
 *    - ربات رو به گروه اضافه کنید (و ادمینش کنید).
 *    - یک پیام تستی در گروه بفرستید، بعد این آدرس رو در مرورگر باز کنید:
 *      https://api.telegram.org/bot<BOT_TOKEN>/getUpdates
 *    - در خروجی JSON دنبال "chat":{"id": -100XXXXXXXXXX, ...} برای همون گروه بگردید.
 *      (آیدی گروه‌ها معمولاً با -100 شروع می‌شه.)
 *
 * 3) آیدی عددی خودتون رو (اگه می‌خواید محدودیت ADMIN بذارید) از طریق
 *    ربات‌هایی مثل @userinfobot بگیرید.
 *
 * 4) در داشبورد Cloudflare یک Worker جدید بسازید، محتوای همین فایل رو
 *    کامل کپی و در ادیتور Paste کنید و Deploy بزنید.
 *
 * 5) در Worker -> Settings -> Variables and Secrets سه متغیر زیر رو اضافه کنید:
 *      BOT_TOKEN       = توکن ربات (Secret)
 *      GROUP_CHAT_ID   = آیدی عددی گروه (مثلاً -1001234567890)
 *      ADMIN_ID        = آیدی عددی شما (اختیاری، اگه خالی بذارید همه می‌تونن استفاده کنن)
 *
 * 6) وبهوک ربات رو به آدرس Workerتون وصل کنید (یک بار کافیه)، با باز کردن
 *    این URL در مرورگر (آدرس Worker خودتون رو جایگزین کنید):
 *
 *    https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-WORKER.workers.dev/
 *
 * تمام. حالا هر پیامی که در پیوی به ربات بفرستید (اگه ADMIN_ID درست باشه)
 * عیناً به گروه فرستاده می‌شه.
 * ------------------------------------------------------------------
 */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK - webhook endpoint is up", { status: 200 });
    }

    let update;
    try {
      update = await request.json();
    } catch (e) {
      return new Response("bad request", { status: 400 });
    }

    const message = update.message;
    if (!message || !message.text) {
      return new Response("ignored", { status: 200 });
    }

    // فقط پیام‌های پیوی (خصوصی) رو پردازش کن، نه پیام‌های داخل گروه‌ها
    if (message.chat.type !== "private") {
      return new Response("ignored (not private)", { status: 200 });
    }

    const senderId = message.from && message.from.id;
    const adminId = env.ADMIN_ID ? Number(env.ADMIN_ID) : null;

    if (adminId && senderId !== adminId) {
      // کاربر غیرمجاز - فقط یک پیام کوتاه بهش بده، چیزی به گروه نفرست
      await sendMessage(env.BOT_TOKEN, message.chat.id, "دسترسی مجاز نیست.");
      return new Response("unauthorized sender", { status: 200 });
    }

    const text = message.text;

    // متن رو خط‌به‌خط جدا کن (خط‌های کاملاً خالی رو نادیده بگیر)
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    for (const line of lines) {
      // نمایش وضعیت "در حال تایپ..." در گروه
      await sendChatAction(env.BOT_TOKEN, env.GROUP_CHAT_ID, "typing");

      // مکث متناسب با طول خط (بین ۶۰۰ میلی‌ثانیه تا ۳ ثانیه)
      const delayMs = Math.min(3000, Math.max(600, line.length * 40));
      await sleep(delayMs);

      // ارسال همون خط به‌عنوان یک پیام مستقل
      await sendMessage(env.BOT_TOKEN, env.GROUP_CHAT_ID, line);
    }

    // تأییدیه به فرستنده در پیوی
    await sendMessage(env.BOT_TOKEN, message.chat.id, "ارسال شد ✅");

    return new Response("ok", { status: 200 });
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
  return res.json();
}

async function sendChatAction(token, chatId, action) {
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: action,
    }),
  });
  return res.json();
}
