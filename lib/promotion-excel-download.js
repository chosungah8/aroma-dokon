'use strict';

// A read-only export: does not depend on the Storage bucket or Excel revision.
// The route must check admin authorization and verify the promotion exists.
async function buildPromotionExcelDownload(supabase, XLSX, promotionId) {
    const id = Number(promotionId);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Aksiya ID noto‘g‘ri');

    const header = ['Ishtirok raqami', 'Telefon', 'Ism', 'Username', 'Qo‘shilgan vaqt'];
    const rows = [header];
    const limit = 500;
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    const formatDate = value => {
        if (!value) return '';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
    };
    const asText = value => value == null ? '' : String(value);

    // Fetch every participant (not just the first page shown in admin.html).
    for (let offset = 0; ; offset += limit) {
        const { data, error } = await supabase.from('promotion_participants')
            .select('participant_number, phone, customer_name, customer_username, created_at')
            .eq('promotion_id', id)
            .order('participant_number', { ascending: true })
            .range(offset, offset + limit - 1);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Ishtirokchilar ro‘yxatini o‘qib bo‘lmadi');

        for (const item of data) {
            rows.push([
                item.participant_number,
                asText(item.phone),
                asText(item.customer_name),
                asText(item.customer_username),
                formatDate(item.created_at)
            ]);
        }
        if (data.length < limit) break;
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [
        { wch: 19 }, { wch: 22 }, { wch: 30 }, { wch: 26 }, { wch: 23 }
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ishtirokchilar');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildPromotionExcelDownload };
