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
    const { data: result, error } = await supabase.rpc('aroma_place_order_v1', {
        p_customer_id: String(ctx.from?.id || ''),
        p_customer_name: ctx.from?.first_name || 'Noma’lum',
        p_customer_username: ctx.from?.username || '',
        p_phone: typeof data.phone === 'string' ? data.phone : '',
        p_address: typeof data.address === 'string' ? data.address : '',
        p_items: data.items,
        p_coupon_code: typeof data.couponCode === 'string' ? data.couponCode : null,
        p_request_key: orderRequestKey(data, ctx)
    });
    if (error) {
        const failure = new Error(error.code === 'P0001' ? error.message : 'Buyurtmani saqlab bo‘lmadi. Qayta urinib ko‘ring.');
        failure.code = error.code;
        failure.customerMessage = failure.message;
        throw failure;
    }
    if (!result?.order?.id) throw new Error('Buyurtma natijasi olinmadi');
    return result;
}
module.exports = { orderRequestKey, placeOrder };
