'use strict';
function parseRegistration(text) {
 const match = /^(?:\/raqam(?:@[A-Za-z0-9_]+)?\s+)?(\+?998\d{9}|\d{9})\s+([0-9]{1,13})(?:\s+(.+))?$/.exec(String(text||'').trim());
 if (!match || Number(match[2])<=100000 || Number(match[2])>1000000000000 || (match[3]||'').length>200) return null;
 return {phone:match[1],amount:Number(match[2]),name:match[3]||''};
}
function configurePromotionBot(bot, supabase, exportExcel) {
 bot.on('message', async ctx => {
  if (ctx.chat?.type !== 'private' || !Number.isSafeInteger(ctx.from?.id)) return;
  const adminId=String(ctx.from.id);
  const {data:admin,error}=await supabase.from('promotion_bot_admins').select('telegram_id').eq('telegram_id',adminId).eq('active',true).maybeSingle();
  if (error) throw Error('Admin lookup failed');
  if (!admin) { await ctx.reply('Ruxsat yo‘q. Telegram ID: '+adminId+'. Do‘kon admin panelida ruxsat berilishi kerak.');return; }
  const text=ctx.message?.text||'';
  const entry=parseRegistration(text);
  if (!entry) {await ctx.reply('Mijoz telefoni, xarid summasi va ismini yuboring:\n\n+998901234567 150000 Ali\n\nSummani bo‘shliqsiz yozing. Tashqi xarid 100 000 so‘mdan ko‘p va faol aksiya minimumidan kam bo‘lmasin. Faqat tekshirilgan xaridni kiriting.');return;}
  const {data:result,error:saveError}=await supabase.rpc('aroma_register_offline_v1',{
   p_admin_id:adminId,p_request_key:'offline:'+ctx.update.update_id,p_phone:entry.phone,p_amount:entry.amount,p_name:entry.name
  });
  if (saveError) {
   if (saveError.code==='P0001') {await ctx.reply(saveError.message);return;}
   throw Error('Registration failed');
  }
  let exported=true;
  try {await exportExcel(result.promotion_id);} catch (_) {exported=false;}
  await ctx.reply(`Aksiya #${result.promotion_id}\nTelefon: ${result.phone}\nIshtirokchi raqami: ${result.participant_number}\n`+
   (result.new_participant?'Ro‘yxatga olindi.':'Bu telefon avval ro‘yxatdan o‘tgan. Mavjud raqam qaytarildi.')+
   (exported?'\nExcel yangilandi.':'\nRaqam bazada saqlandi. Excel yangilanmadi; admin paneldagi Excel tugmasi orqali qayta yuklang.'));
 });
 return bot;
}
module.exports={parseRegistration,configurePromotionBot};
