'use strict';
function orderRequestKey(data, ctx) {
    if (data.requestId !== undefined) {
        if (typeof data.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.requestId)) {
            throw new Error('Buyurtma kaliti noto‘g‘ri');
        }
        return 'client:' + data.requestId.toLowerCase();
    }
    if (Number.isSafeInteger(ctx.update?.update_id)) return 'telegram:' + ctx.update.update_id;
    if (Number.isSafeInteger(ctx.message?.message_id) && ctx.chat?.id) {
        return 'message:' + ctx.chat.id + ':' + ctx.message.message_id;
    }
    throw new Error('Buyurtma xabarini aniqlab bo‘lmadi');
}

async function placeOrder(supabase, data, ctx) {
    const personalId = data.personalCouponId == null ? null : Number(data.personalCouponId);
    if (personalId !== null && (!Number.isSafeInteger(personalId) || personalId < 1)) throw new Error('Shaxsiy kupon noto‘g‘ri');
    // bonusSpent faqat butun, musbat yoki nol son bo'lishi mumkin.
    // Bonus yuborilmasa, eski buyurtma yo'li o'zgarmaydi.
    const bonusSpent = data.bonusSpent === undefined ? 0 : data.bonusSpent;

    if (!Number.isSafeInteger(bonusSpent) ||
        bonusSpent < 0 ||
        bonusSpent > 1000000000) {
        throw new Error('Sarflanadigan bonus miqdori noto‘g‘ri');
    }

    const useBonusRpc = bonusSpent > 0;

    const rpcName = useBonusRpc
        ? 'aroma_place_order_with_bonus_v1'
        : personalId === null
            ? 'aroma_place_order_v2'
            : 'aroma_place_order_v3';

    const rpcParams = {
        p_customer_id: String(ctx.from?.id || ''),
        p_customer_name: ctx.from?.first_name || 'Noma’lum',
        p_customer_username: ctx.from?.username || '',
        p_phone: typeof data.phone === 'string' ? data.phone : '',
        p_address: typeof data.address === 'string' ? data.address : '',
        p_items: data.items,
        p_coupon_code: typeof data.couponCode === 'string' ? data.couponCode : null,
        p_request_key: orderRequestKey(data, ctx),
        ...(useBonusRpc
            ? {
                p_spend_points: bonusSpent,
                p_personal_coupon_id: personalId
            }
            : personalId === null
                ? {}
                : { p_personal_coupon_id: personalId })
    };

    const { data: result, error } = await supabase.rpc(
        rpcName,
        rpcParams
    );
    if (error) {
        const failure = new Error(error.code === 'P0001' ? error.message : 'Buyurtmani saqlab bo‘lmadi. Qayta urinib ko‘ring.');
        failure.code = error.code;
        failure.customerMessage = failure.message;
        throw failure;
    }
    if (result?.rejected) {
        const failure = new Error(result.message || 'Buyurtma qabul qilinmadi.');
        failure.customerMessage = failure.message;
        throw failure;
    }
    if (!result?.order?.id) throw new Error('Buyurtma natijasi olinmadi');
    return useBonusRpc
        ? { ...result, order: { ...result.order, bonus_spent: bonusSpent } }
        : result;
}
async function orderReceipt(supabase, token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
        return { status: 400, body: { error: 'Noto‘g‘ri kalit' } };
    }
    // A random 122-bit receipt capability reveals no customer or item data.
    const key = 'client:' + token.toLowerCase();
    const order = await supabase.from('orders').select('id').eq('request_key', key).limit(1).maybeSingle();
    if (order.error) throw new Error('Receipt lookup failed');
    if (order.data) return { status: 200, body: { state: 'accepted', orderId: order.data.id } };
    const rejected = await supabase.from('order_receipt_failures').select('reason').eq('request_key', key).limit(1).maybeSingle();
    if (rejected.error) throw new Error('Receipt lookup failed');
    if (rejected.data) return { status: 200, body: { state: 'rejected', message: rejected.data.reason } };
    return { status: 200, body: { state: 'pending' } };
}
module.exports = { orderRequestKey, placeOrder, orderReceipt };
