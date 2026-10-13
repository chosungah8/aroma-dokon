'use strict';
const crypto = require('crypto');
const { readLimitedJson } = require('./product-requests.js');
const MAX_AMOUNT = 1_000_000_000;
const ID_PATTERN = /^[1-9][0-9]{0,19}$/;
function bad(message, status=400) { const error=new Error(message); error.status=status; return error; }
function normalizeTarget(payload) {
  const kind = String(payload?.targetType || '');
  const target = String(payload?.target || '').trim();
  if (!['phone','telegram'].includes(kind)) throw bad('Mijozni telefon yoki Telegram ID orqali tanlang.');
  if (kind === 'telegram' && !ID_PATTERN.test(target)) throw bad('Telegram ID noto‘g‘ri.');
  if (kind === 'phone' && !/^\+?[0-9\s()\-]{9,30}$/.test(target)) throw bad('Telefon raqami noto‘g‘ri.');
  return {kind, target};
}
function normalizeInput(payload) {
  const {kind, target} = normalizeTarget(payload);
  const discountType = String(payload?.discountType || '');
  const discountValue = Number(payload?.discountValue);
  const minOrderAmount = Number(payload?.minOrderAmount);
  const days = Number(payload?.days);
  if (!['fixed','percent'].includes(discountType) || !Number.isInteger(discountValue) ||
      discountValue < 1 || discountValue > (discountType === 'percent' ? 100 : MAX_AMOUNT))
      throw bad('Chegirma summasi yoki foizi noto‘g‘ri.');
  if (!Number.isSafeInteger(minOrderAmount) || minOrderAmount < 0 || minOrderAmount > MAX_AMOUNT)
      throw bad('Minimal xarid summasi noto‘g‘ri.');
  if (!Number.isInteger(days) || days < 1 || days > 365) throw bad('Amal qilish muddati 1–365 kun bo‘lsin.');
  return {kind, target, discountType, discountValue, minOrderAmount, days};
}
function isActivePersonal(c, now=Date.now()) {
  return c && c.active === true && !c.used_at &&
    Number.isFinite(Date.parse(c.expires_at)) && Date.parse(c.expires_at) > now;
}
async function resolveCustomer(supabase, input) {
  if (input.kind === 'telegram') return input.target;
  const {data, error} = await supabase.rpc('aroma_find_personal_coupon_customer_v1', {p_phone:input.target});
  if (error) throw error;
  const customers = [...new Set((data||[]).map(x=>String(x.customer_id)))];
  if (!customers.length) throw bad('Bu raqam bilan buyurtma qilgan mijoz topilmadi. Telegram ID orqali tanlang.', 404);
  if (customers.length !== 1) throw bad('Bu telefonda bir nechta Telegram akkaunt topildi. Telegram ID orqali tanlang.', 409);
  if (!ID_PATTERN.test(customers[0])) throw bad('Mijozning Telegram ID raqami topilmadi.', 404);
  return customers[0];
}
function sendJson(res,status,body){
  res.setHeader('Cache-Control','no-store, private');
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(body));
}
async function handlePersonalCouponRoutes(req,res,url,{supabase,isAdmin,verifiedMiniAppUser,botToken,bot}) {
  const path=url.pathname;
  const isMine=path==='/api/coupons/personal/mine' && req.method==='GET';
  const isAdminPath=path==='/api/admin/personal-coupons';
  const isLookup=path==='/api/admin/personal-coupons/lookup' && req.method==='POST';
  const isCancel=path==='/api/admin/personal-coupons/cancel' && req.method==='POST';
  if(!isMine && !isAdminPath && !isLookup && !isCancel) return false;
  try {
    if (isMine) {
      const user=verifiedMiniAppUser(req.headers['x-telegram-init-data'],botToken);
      if (!user?.id) return sendJson(res,401,{success:false,message:'Telegram seansi eskirgan. Botdan qayta oching.'}),true;
      const {data,error}=await supabase.from('personal_coupons')
        .select('id,code,discount_type,discount_value,min_order_amount,expires_at,active,used_at')
        .eq('customer_id',String(user.id)).order('created_at',{ascending:false}).limit(50);
      if (error) throw error;
      return sendJson(res,200,{success:true,coupons:(data||[]).map(c=>({
        id:c.id,code:c.code,discountType:c.discount_type,discountValue:Number(c.discount_value),
        minOrderAmount:Number(c.min_order_amount),expiresAt:c.expires_at,
        active:isActivePersonal(c),status:c.used_at?'used':!c.active?'cancelled':Date.parse(c.expires_at)<=Date.now()?'expired':'active'
      }))}),true;
    }
    if (!isAdmin) return sendJson(res,401,{success:false,message:'Admin ruxsati kerak.'}),true;
    if (isLookup) {
      // Read-only admin verification: never create a coupon or send a Telegram message here.
      const input=normalizeTarget(await readLimitedJson(req,1024));
      if (input.kind === 'telegram') {
        return sendJson(res,200,{success:true,mode:'telegram',valid:true,
          customerId:input.target,confirmed:false,
          message:'Telegram ID formati to‘g‘ri. Bu ID egasi mavjudligini oldindan tasdiqlab bo‘lmaydi. Kupon yuborilmadi.'}),true;
      }
      const customerId=await resolveCustomer(supabase,input);
      return sendJson(res,200,{success:true,mode:'phone',confirmed:true,customerId,
        message:'Telefon bo‘yicha mijoz topildi. Telegram ID: '+customerId+'. Kupon yuborilmadi.'}),true;
    }
    if (isAdminPath && req.method==='GET') {
      const {data,error}=await supabase.from('personal_coupons').select('*')
        .order('created_at',{ascending:false}).limit(100);
      if(error) throw error;
      return sendJson(res,200,{success:true,coupons:data||[]}),true;
    }
    if (isAdminPath && req.method==='POST') {
      const p=normalizeInput(await readLimitedJson(req,4096));
      const customerId=await resolveCustomer(supabase,p);
      const code='VIP-'+crypto.randomBytes(7).toString('hex').toUpperCase();
      const expiresAt=new Date(Date.now()+p.days*86400000).toISOString();
      const {data:coupon,error}=await supabase.from('personal_coupons').insert({
        code, customer_id:customerId, discount_type:p.discountType,
        discount_value:p.discountValue,min_order_amount:p.minOrderAmount,
        expires_at:expiresAt,active:true
      }).select('*').single();
      if(error) throw error;
      let telegramSent=false;
      try {
        const discountText=p.discountType==='percent' ? `${p.discountValue}%` : `${p.discountValue.toLocaleString('en-US')} so‘m`;
        await bot.telegram.sendMessage(customerId,
          `🎁 Aroma Kosmetika — sizga shaxsiy kupon!\n\nKod: ${code}\nChegirma: ${discountText}\nMinimal xarid: ${p.minOrderAmount.toLocaleString('en-US')} so‘m\nMuddat: ${p.days} kun\n\nOddiy kupon bilan birga ishlaydi. Savatda avtomatik qo‘llanadi.\nDo‘kon: @aromakosmetika_bot`);
        telegramSent=true;
      } catch (_) { /* Still persist voucher: Telegram only delivers to users who started the bot. */ }
      return sendJson(res,200,{success:true,coupon,telegramSent,message:telegramSent
          ? 'Kupon berildi va Telegram orqali yuborildi.'
          : 'Kupon saqlandi, ammo Telegram xabari yuborilmadi. Mijoz botni /start qilib ochishi kerak.'}),true;
    }
    if (isCancel) {
      const payload=await readLimitedJson(req,512);
      const id=Number(payload.id);
      if (!Number.isSafeInteger(id)||id<1) throw bad('Kupon ID noto‘g‘ri.');
      const {data,error}=await supabase.from('personal_coupons').update({active:false})
        .eq('id',id).is('used_at',null).select('id').maybeSingle();
      if(error) throw error;
      return sendJson(res,data?200:404,{success:!!data,message:data?'Kupon bekor qilindi.':'Kupon topilmadi yoki ishlatilgan.'}),true;
    }
    return sendJson(res,405,{success:false,message:'Noto‘g‘ri metod.'}),true;
  } catch (error) {
    console.error('PERSONAL COUPON ERROR',error?.code||null,error?.message||'');
    const status=error.status|| (error?.code==='23505'?409:503);
    return sendJson(res,status,{success:false,message:error.status ? error.message :
      'Shaxsiy kuponlarni qayta ishlashda xatolik. SQL o‘rnatilganini tekshiring.'}),true;
  }
}
module.exports={normalizeTarget,normalizeInput,resolveCustomer,isActivePersonal,handlePersonalCouponRoutes};
